// [fork] Separate drizzle-kit track for fork tables, see docs/adr/0002-eigene-migrationsspur-fuer-fork.md.
import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { resolveDatabasePath } from "./lib/db/db-path.mjs";

export default defineConfig({
  out: "./drizzle/fork",
  schema: ["./lib/rotation/schema.ts", "./lib/swap/schema.ts"],
  dialect: "sqlite",
  dbCredentials: {
    url: resolveDatabasePath(),
  },
});
