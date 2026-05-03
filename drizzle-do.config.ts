import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle/do_migrations",
  schema: "./src/db/do_storage/schemas/*",
  dialect: "sqlite",
  driver: "durable-sqlite",
});
