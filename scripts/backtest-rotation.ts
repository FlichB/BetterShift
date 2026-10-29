/**
 * Test helper: prints the plan of a rotation from its Beginn on, as if nothing had been served
 * yet, so it can be compared with a manual plan. Begun days are included (the generator in the
 * app never writes them); approved vacations, Schließtage and verstärkte Tage are honoured.
 * Read-only — run it against a copy of the database.
 *
 * Usage (from the repo root):
 *   DATABASE_URL=file:data/test.db npx tsx scripts/backtest-rotation.ts                          # lists rotations
 *   DATABASE_URL=file:data/test.db npx tsx scripts/backtest-rotation.ts "Samstagsdienste Q4 2026" 2027-01-17
 *   DATABASE_URL=file:data/test.db npx tsx scripts/backtest-rotation.ts <id|name> 2027-01-17 --csv plan.csv
 */
import fs from "node:fs";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { rotations } from "@/lib/rotation/schema";
import { backtestDays, getRotation } from "@/lib/rotation/service";

const [key, to, flag, csvPath] = process.argv.slice(2);
const all = db.select({ id: rotations.id, name: rotations.name, startDate: rotations.startDate }).from(rotations).all();

if (!key || !to) {
  console.log("Rotationen:");
  for (const r of all) console.log(`  ${r.id}  ${r.name}  (Beginn ${r.startDate})`);
  console.log('\nAufruf: npx tsx scripts/backtest-rotation.ts <id|name> <bis YYYY-MM-DD> [--csv datei.csv]');
  process.exit(0);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error(`Ungültiges Bis-Datum: ${to}`);
const matches = all.filter((r) => r.id === key || r.name === key);
if (matches.length !== 1) throw new Error(matches.length ? `Name "${key}" ist nicht eindeutig, bitte die ID angeben.` : `Rotation "${key}" nicht gefunden.`);

const rotation = getRotation(matches[0].id)!;
const names = new Map(db.select({ id: user.id, name: user.name }).from(user).all().map((u) => [u.id, u.name]));
const nameOf = (id: string) => names.get(id) ?? id;
const { duties, closures } = backtestDays(rotation.id, to);

const weekday = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("de-AT", { weekday: "short" });
const rows = [
  ...duties.map((d) => ({
    date: d.date,
    text: d.userIds.map(nameOf).join(", "),
    note: [d.capacity && d.capacity !== rotation.perShift ? `${d.capacity} Personen` : "", d.userIds.length < (d.capacity ?? rotation.perShift) ? "unterbesetzt" : "", d.openHoliday ? `geöffnet: ${d.openHoliday}` : ""]
      .filter(Boolean)
      .join("; "),
  })),
  ...closures.map((c) => ({ date: c.date, text: `${rotation.closedTitle} (${c.reason})`, note: "" })),
].sort((a, b) => a.date.localeCompare(b.date));

console.log(`${rotation.name}: ${rotation.startDate} bis ${to}\n`);
for (const r of rows) console.log(`${weekday(r.date)} ${r.date}  ${r.text}${r.note ? `  [${r.note}]` : ""}`);

const counts = new Map(rotation.memberIds.map((u) => [u, 0]));
for (const d of duties) for (const u of d.userIds) counts.set(u, (counts.get(u) ?? 0) + 1);
console.log("\nDienste pro Person:");
for (const [u, n] of counts) console.log(`  ${nameOf(u).padEnd(28)} ${n}`);

if (flag === "--csv") {
  if (!csvPath) throw new Error("--csv braucht einen Dateinamen.");
  const cell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ["Datum;Tag;Besetzung;Hinweis", ...rows.map((r) => [r.date, weekday(r.date), r.text, r.note].map(cell).join(";"))];
  fs.writeFileSync(csvPath, "﻿" + lines.join("\r\n") + "\r\n", "utf8");
  console.log(`\nCSV geschrieben: ${csvPath}`);
}
