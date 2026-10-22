// Runs before every test file: a fresh SQLite file with both migration tracks.
// lib/db opens DATABASE_URL at import time, so this must run before any import of it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const file = path.join(os.tmpdir(), `bettershift-test-${process.pid}-${crypto.randomUUID()}.db`);
process.env.DATABASE_URL = `file:${file}`;

const sqlite = new Database(file);
const db = drizzle(sqlite);
migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
migrate(db, {
  migrationsFolder: path.join(process.cwd(), "drizzle", "fork"),
  migrationsTable: "__drizzle_migrations_fork",
});
sqlite.close();

process.on("exit", () => fs.rmSync(file, { force: true }));
