import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { FREQUENCIES } from "../../../schemas/monitor.schema";

const MONITOR_STATUSES = [
  "pending",
  "active",
  "alarm_failed",
  "stopped",
] as const;

export const registry = sqliteTable("registry", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  url: text("url").notNull().unique(),
  frequency: text("frequency", { enum: FREQUENCIES }).notNull(),
  status: text("status", { enum: MONITOR_STATUSES }).notNull().default("pending"),

  alertOnLatencyMs: integer("alert_on_latency_ms"),
  alertOnStatusAbove: integer("alert_on_status_above"),
  alertOnBodyContains: text("alert_on_body_contains"),

  createdAt: text("created_at").notNull(),
});

