import { DurableObject } from "cloudflare:workers";
import z from "zod";
import { Err, Ok, Result } from "./utils/result";
import { appError, validationError } from "./utils/errors";
import { createNeonDb } from "./db/neon";
import { checkLogs } from "./db/neon/schemas/logs.schema";

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

const FREQUENCY_MAP: Record<Frequency, number> = {
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

const ALERT_STATUSES = ["idle", "triggered", "acknowledged"] as const;

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

export class AlarmMakerDO extends DurableObject<CloudflareBindings> {
  constructor(state: DurableObjectState, env: CloudflareBindings) {
    super(state, env);
  }

  async start(incomingConfig: InputConfig): Promise<Result<{ msg: string }>> {
    const parsed = inputConfigSchema.safeParse(incomingConfig);
    if (!parsed.success) {
      return Err(validationError(parsed.error));
    }

    const configRes = await this.getConfig();
    if (!configRes.ok && configRes.error.type !== "notInitialized") {
      return Err(
        appError(
          500,
          "serverErr",
          "Couldn't check for existing alarm, try again",
        ),
      );
    }

    const config = parsed.data;
    const interval = FREQUENCY_MAP[config.frequency];
    const alarmAt = Date.now() + interval;

    try {
      await this.ctx.storage.setAlarm(alarmAt);
      this.setConfig({
        id: this.ctx.id.toString(),
        ...config,
        nextAlarmAt: new Date(alarmAt).toISOString(),
        alertStatus: "idle",
      });
      console.log(
        "Alarm Created",
        this.ctx.id.toString(),
        new Date(alarmAt).toLocaleTimeString(),
      );
      return Ok({ msg: "Alarm created successfully" });
    } catch (cause) {
      console.error("Failed to create alarm", cause);
      return Err(appError(500, "serverErr", "Failed to create alarm"));
    }
  }

  async alarm() {
    const configRes = await this.getConfig();
    if (!configRes.ok) {
      console.error("Invalid config in alarm:", configRes.error);
      return;
    }
    const config = configRes.data;
    const frequency = FREQUENCY_MAP[config.frequency];
    const now = new Date().toISOString();
    const nextAlarmAt = Date.now() + frequency;

    await this.ctx.storage.setAlarm(nextAlarmAt);
    const checkResult = await this.performCheck(config);
    const alertReason = this.evaluateAlertConditions(config, checkResult);
    let newAlertStatus = config.alertStatus;

    if (alertReason) {
      if (config.alertStatus === "idle") {
        console.log("SENT ALERT:", alertReason, "for", config.url);
        newAlertStatus = "triggered";
      }
    } else {
      newAlertStatus = "idle";
    }

    try {
      const db = createNeonDb(this.env.DATABASE_URL);
      await db.insert(checkLogs).values({
        monitorId: config.id,
        url: config.url,
        statusCode: checkResult.statusCode,
        latencyMs: checkResult.latencyMs,
        error: checkResult.error ?? null,
        alertTriggered: alertReason ?? null,
      });
    } catch (e) {
      console.error("Failed to write check log to Neon:", e);
    }

    this.setConfig({
      ...config,
      lastAlarmAt: now,
      nextAlarmAt: new Date(nextAlarmAt).toISOString(),
      alertStatus: newAlertStatus,
    });

    console.log("ALARM TRIGGERED", now, config.url, checkResult);
  }

  async stop(): Promise<Result<{ msg: string }>> {
    const configRes = await this.getConfig();
    if (!configRes.ok) {
      return Err(configRes.error);
    }

    await this.ctx.storage.deleteAlarm();
    const config = configRes.data;
    this.setConfig({
      ...config,
      nextAlarmAt: null,
      alertStatus: "idle",
    });
    return Ok({ msg: "Alarm stopped successfully" });
  }
  async setFrequency(incomingFrequency: Frequency): Promise<Result<{ msg: string }>> {
    const configRes = await this.getConfig();
    if (!configRes.ok) {
      return Err(configRes.error);
    }

    await this.ctx.storage.deleteAlarm();

    const interval = FREQUENCY_MAP[incomingFrequency];
    const nextAlarmAt = Date.now() + interval;
    await this.ctx.storage.setAlarm(nextAlarmAt);

    this.setConfig({
      ...configRes.data,
      frequency: incomingFrequency,
      nextAlarmAt: new Date(nextAlarmAt).toISOString(),
      alertStatus: "idle",
    });

    return Ok({ msg: "Frequency updated" });
  }

  async acknowledgeAlert(): Promise<Result<{ msg: string }>> {
    const configRes = await this.getConfig();
    if (!configRes.ok) {
      return Err(configRes.error);
    }
    const config = configRes.data;
    if (config.alertStatus !== "triggered") {
      return Err(appError(400, "clientErr", "No active alert to acknowledge"));
    }
    this.setConfig({
      ...config,
      alertStatus: "acknowledged",
    });
    return Ok({ msg: "Alert acknowledged" });
  }

  async getConfig(): Promise<Result<Config>> {
    const stored = this.ctx.storage.kv.get<Config>("config");
    if (!stored) {
      return Err(
        appError(
          404,
          "notInitialized",
          "Config not found, alarm may not be initialized",
        ),
      );
    }
    const parsed = configSchema.safeParse(stored);
    if (!parsed.success) {
      return Err(validationError(parsed.error));
    }
    return Ok(parsed.data);
  }

  private setConfig(config: Config) {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) {
      console.error("setConfig validation failed:", parsed.error.flatten());
      throw new Error("Invalid config passed to setConfig");
    }
    this.ctx.storage.kv.put("config", parsed.data);
  }

  private async performCheck(config: Config): Promise<{
    statusCode: number | null;
    latencyMs: number | null;
    body: string | null;
    error: string | null;
  }> {
    try {
      const start = Date.now();
      const response = await fetch(config.url, {
        method: "GET",
        signal: AbortSignal.timeout(30_000),
      });
      const latencyMs = Date.now() - start;
      const body = await response.text();
      return {
        statusCode: response.status,
        latencyMs,
        body,
        error: null,
      };
    } catch (e) {
      return {
        statusCode: null,
        latencyMs: null,
        body: null,
        error: (e as Error).message ?? String(e),
      };
    }
  }

  private evaluateAlertConditions(
    config: Config,
    check: {
      statusCode: number | null;
      latencyMs: number | null;
      body: string | null;
      error: string | null;
    },
  ): string | null {
    if (check.error) {
      return `Fetch failed: ${check.error}`;
    }

    if (
      config.alertOnLatencyMs &&
      check.latencyMs &&
      check.latencyMs > config.alertOnLatencyMs
    ) {
      return `Latency ${check.latencyMs}ms exceeds threshold ${config.alertOnLatencyMs}ms`;
    }

    if (
      config.alertOnStatusAbove &&
      check.statusCode &&
      check.statusCode >= config.alertOnStatusAbove
    ) {
      return `Status ${check.statusCode} >= threshold ${config.alertOnStatusAbove}`;
    }

    if (
      config.alertOnBodyContains &&
      check.body &&
      check.body.includes(config.alertOnBodyContains)
    ) {
      return `Response body contains "${config.alertOnBodyContains}"`;
    }

    return null;
  }
}
