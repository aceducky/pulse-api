import { pgTable, text, integer, timestamp, uuid } from "drizzle-orm/pg-core";

export const checkLogs = pgTable("check_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  monitorId: text("monitor_id").notNull(),
  url: text("url").notNull(),
  statusCode: integer("status_code"),
  latencyMs: integer("latency_ms"),
  error: text("error"),
  alertTriggered: text("alert_triggered"),
  checkedAt: timestamp("checked_at").notNull().defaultNow(),
});
