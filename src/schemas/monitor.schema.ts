import z from "zod";

export const FREQUENCIES = [
  "1m",
  "5m",
  "10m",
  "30m",
  "1h",
  "6h",
  "12h",
  "1d",
  "3d",
  "1w",
  "2w",
  "1mon",
] as const;
export const frequencySchema = z.enum(FREQUENCIES);
export type Frequency = z.infer<typeof frequencySchema>;

const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;
const day = 24 * hour;
const week = 7 * day;
const month = 30 * day;

export const FREQUENCY_MAP: Record<Frequency, number> = {
  "1m": 1 * minute,
  "5m": 5 * minute,
  "10m": 10 * minute,
  "30m": 30 * minute,
  "1h": 1 * hour,
  "6h": 6 * hour,
  "12h": 12 * hour,
  "1d": 1 * day,
  "3d": 3 * day,
  "1w": 1 * week,
  "2w": 2 * week,
  "1mon": 1 * month,
} as const;

export const ALERT_STATUSES = ["idle", "triggered", "acknowledged"] as const;

export const urlSchema = z.url().toLowerCase().trim();

export const configSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, "Name is required"),
  url: urlSchema,
  frequency: frequencySchema,
  lastAlarmAt: z.string().optional().nullable(),
  nextAlarmAt: z.string().optional().nullable(),

  alertOnLatencyMs: z.number().positive().optional().nullable(),
  alertOnStatusAbove: z.number().int().min(100).max(599).optional().nullable(),
  alertOnBodyContains: z.string().min(1).optional().nullable(),

  alertStatus: z.enum(ALERT_STATUSES).default("idle"),
});

export const inputConfigSchema = configSchema.omit({
  id: true,
  lastAlarmAt: true,
  nextAlarmAt: true,
  alertStatus: true,
});

export type InputConfig = z.infer<typeof inputConfigSchema>;
export type Config = z.infer<typeof configSchema>;

export const idParamSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{64}$/, "Invalid monitor ID format"),
});

export const updateFrequencySchema = z.object({
  incomingFrequency: frequencySchema,
});
