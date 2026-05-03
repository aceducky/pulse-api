import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

export function createNeonDb(databaseUrl: string) {
  const sql = neon(databaseUrl);
  return drizzle({ client: sql });
}
