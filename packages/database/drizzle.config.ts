import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { defineConfig } from "drizzle-kit";

for (const environmentFile of [
  new URL("../../.env", import.meta.url),
  new URL("../../.env.local", import.meta.url),
]) {
  if (existsSync(environmentFile)) {
    loadEnvFile(environmentFile);
  }
}

const databaseUrl = process.env.DATABASE_URL;

const config = {
  dialect: "postgresql",

  schema: "./src/schema.ts",

  out: "./drizzle",

  migrations: {
    table: "__picloud_migrations",
    schema: "drizzle",
  },
} as const;

export default defineConfig(
  databaseUrl
    ? {
        ...config,

        dbCredentials: {
          url: databaseUrl,
        },
      }
    : config,
);
