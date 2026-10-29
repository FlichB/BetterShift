#!/usr/bin/env node
/**
 * Test helper: writes approved vacations, past ones included, straight into a
 * COPY of the database. The app refuses vacations that have begun; this skips
 * the API on purpose, so it also skips replanning, notifications and the audit
 * log. Generate the rotation to compare against afterwards.
 *
 * Usage (from the repo root):
 *   node scripts/seed-past-vacations.mjs --db data/test.db --copy-from data/sqlite.db --csv urlaube.csv
 *   node scripts/seed-past-vacations.mjs --db data/test.db --csv urlaube.csv --apply
 *
 * Without --apply nothing is written (dry run). --copy-from copies the source
 * database to --db first and refuses to overwrite an existing file.
 *
 * CSV, one vacation per line, separated by ";" or ",":
 *   person;von;bis;notiz
 *   anna@example.com;2026-08-10;2026-08-21;Sommer
 *   Bernd Muster;24.12.2026;31.12.2026;
 * person = e-mail or exact display name; dates as YYYY-MM-DD or DD.MM.YYYY;
 * notiz is optional. Empty lines and lines starting with # are skipped.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { resolveDatabasePath } from "../lib/db/db-path.mjs";

const MAX_DAYS = 366; // same limit as checkNewRange in lib/vacation/validate.ts

function parseArgs(argv) {
  const args = { apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") args.apply = true;
    else if (["--db", "--csv", "--copy-from", "--by"].includes(arg)) args[arg.slice(2)] = argv[(i += 1)];
    else fail(`Unbekanntes Argument: ${arg}`);
  }
  if (!args.db || !args.csv) fail("Aufruf: --db <kopie.db> --csv <urlaube.csv> [--copy-from <quelle.db>] [--by <admin>] [--apply]");
  return args;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function toIsoDate(value) {
  const v = value.trim();
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v);
  const iso = de ? `${de[3]}-${de[2].padStart(2, "0")}-${de[1].padStart(2, "0")}` : v;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  // Day-number check without a UTC shift of the local date: the round trip must match.
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? iso : null;
}

const dayNumber = (iso) => Date.UTC(...iso.split("-").map((n, i) => Number(n) - (i === 1 ? 1 : 0))) / 86400000;

const args = parseArgs(process.argv.slice(2));
const target = path.resolve(args.db);
const live = path.resolve(resolveDatabasePath());
if (target === live) fail(`Ziel ${target} ist die Datenbank der App. Bitte eine Kopie angeben.`);

if (args["copy-from"]) {
  const source = path.resolve(args["copy-from"]);
  if (fs.existsSync(target)) fail(`${target} existiert schon; --copy-from überschreibt nichts.`);
  // Online backup instead of a file copy, so a running server's WAL content is included.
  const src = new Database(source, { readonly: true });
  await src.backup(target);
  src.close();
  console.log(`Kopie erstellt: ${source} → ${target}`);
} else if (!fs.existsSync(target)) {
  fail(`${target} gibt es nicht. Mit --copy-from <quelle.db> anlegen.`);
}

const sqlite = new Database(target);
const users = sqlite.prepare("select id, name, email from user").all();
const findUser = (key) => {
  const k = key.trim().toLowerCase();
  const matches = users.filter((u) => u.email.toLowerCase() === k || u.name.toLowerCase() === k);
  return matches.length === 1 ? matches[0] : matches.length > 1 ? "ambiguous" : null;
};

let by = null;
if (args.by) {
  by = findUser(args.by);
  if (!by || by === "ambiguous") fail(`--by: Person "${args.by}" nicht eindeutig gefunden.`);
}

const blocking = sqlite.prepare(`
  select start_date as "from", end_date as "to" from vacations
   where user_id = ? and status in ('pending', 'approved')
  union all
  select c.start_date, c.end_date from vacation_changes c join vacations v on v.id = c.vacation_id
   where v.user_id = ? and c.status = 'pending' and c.kind = 'change' and c.start_date is not null
`);
const insert = sqlite.prepare(`
  insert into vacations (id, user_id, start_date, end_date, note, status, requested_by, decided_by, decided_at, created_at, updated_at)
  values (?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?)
`);

const lines = fs.readFileSync(args.csv, "utf8").replace(/^﻿/, "").split(/\r?\n/);
const planned = [];
let errors = 0;
lines.forEach((raw, index) => {
  const line = raw.trim();
  if (!line || line.startsWith("#")) return;
  const [person = "", fromRaw = "", toRaw = "", ...rest] = line.split(/[;,]/);
  if (index === 0 && !toIsoDate(fromRaw)) return; // header row
  const where = `Zeile ${index + 1}`;
  const u = findUser(person);
  const from = toIsoDate(fromRaw);
  const to = toIsoDate(toRaw);
  let problem = null;
  if (!u) problem = `Person "${person.trim()}" nicht gefunden`;
  else if (u === "ambiguous") problem = `Person "${person.trim()}" ist nicht eindeutig`;
  else if (!from || !to) problem = `ungültiges Datum "${fromRaw.trim()}" / "${toRaw.trim()}"`;
  else if (from > to) problem = `Beginn ${from} liegt nach dem Ende ${to}`;
  else if (dayNumber(to) - dayNumber(from) + 1 > MAX_DAYS) problem = `länger als ${MAX_DAYS} Tage`;
  else {
    const taken = [...blocking.all(u.id, u.id), ...planned.filter((p) => p.user.id === u.id)];
    const clash = taken.find((r) => r.from <= to && from <= r.to);
    if (clash) problem = `überschneidet sich mit ${clash.from} – ${clash.to}`;
  }
  if (problem) {
    errors += 1;
    console.error(`✗ ${where}: ${problem}`);
    return;
  }
  const note = rest.join(",").trim() || null;
  planned.push({ user: u, from, to, note });
  console.log(`✓ ${where}: ${u.name} ${from} – ${to}${note ? ` (${note})` : ""}`);
});

if (errors > 0) fail(`\n${errors} fehlerhafte Zeile(n), nichts geschrieben.`);
if (!args.apply) {
  console.log(`\nProbelauf: ${planned.length} Urlaub(e) würden eingetragen. Mit --apply schreiben.`);
  process.exit(0);
}

// The vacations columns are drizzle "timestamp" mode, i.e. Unix seconds.
const now = Math.floor(Date.now() / 1000);
sqlite.transaction(() => {
  for (const p of planned) {
    const actor = by?.id ?? p.user.id;
    insert.run(crypto.randomUUID(), p.user.id, p.from, p.to, p.note, actor, actor, now, now, now);
  }
})();
sqlite.close();
console.log(`\n${planned.length} Urlaub(e) in ${target} eingetragen.`);
