# 0002 – Eigene Migrationsspur für die Fork-Tabellen

- Status: angenommen
- Datum: 2026-10-21

## Kontext

Upstream legt Migrationen fortlaufend in `drizzle/` an (`0000…0032`, `meta/_journal.json`). Der drizzle-Migrator wendet nur Migrationen an, deren Zeitstempel jünger ist als der zuletzt angewendete. Würde der Fork eigene Migrationen in dieselbe Spur schreiben, kollidieren beim nächsten Upstream-Merge Nummern, Snapshots und Journal – und eine Upstream-Migration mit älterem Zeitstempel als unsere würde auf bestehenden Datenbanken **stillschweigend übersprungen**.

## Entscheidung

- Fork-Tabellen liegen in eigenen Schema-Dateien (`lib/rotation/schema.ts`, später `lib/swap/schema.ts`), nicht in `lib/db/schema.ts`.
- Eigene drizzle-kit-Konfiguration `drizzle.fork.config.ts` mit Ausgabe nach `drizzle/fork/` (wird vom Dockerfile über `COPY drizzle` automatisch mitkopiert).
- `scripts/migrate.mjs` wendet nach den Upstream-Migrationen die Fork-Migrationen mit eigener Tracking-Tabelle `__drizzle_migrations_fork` an.
- `npm run db:generate` erzeugt beide Spuren; der Ablauf bleibt `db:generate` / `db:migrate`.

## Verworfene Alternativen

- **Gemeinsame Spur in `drizzle/`** – einfach, aber Merge-Konflikte bei jedem Upstream-Schema-Update und Gefahr übersprungener Migrationen.
- **Fork-Tabellen in `lib/db/schema.ts`** – Konflikte in der meistgeänderten Upstream-Datei.

## Folgen

- Fork-Tabellen werden nicht in das relationale `db.query`-API von Upstream eingebunden; Fork-Code nutzt die Core-Query-API (`db.select()…`).
- Fremdschlüssel auf Upstream-Tabellen (`shifts`, `user`, `calendars`, `shift_presets`) sind erlaubt; benennt Upstream diese Tabellen um, muss die Fork-Spur nachziehen.
- Die Fork-Spur muss immer nach der Upstream-Spur laufen.
