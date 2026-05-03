import { DurableObject } from "cloudflare:workers";
import { Err, Ok, Result } from "./utils/result";
import { appError, validationError } from "./utils/errors";
import { createNeonDb } from "./db/neon";
import { checkLogs } from "./db/neon/schemas/logs.schema";
import {
  configSchema,
  inputConfigSchema,
  FREQUENCY_MAP,
  type Config,
  type InputConfig,
  type Frequency,
} from "./schemas/monitor.schema";
import z from "zod";

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
      const fullConfig: Config = {
        id: this.ctx.id.toString(),
        ...config,
        nextAlarmAt: new Date(alarmAt).toISOString(),
        alertStatus: "idle",
      };
      this.setConfig(fullConfig);
      console.log(
        "Alarm Created",
        this.ctx.id.toString(),
        new Date(alarmAt).toLocaleTimeString(),
      );

      // Fire an immediate check so there's a log entry right away
      // instead of the user waiting for the first scheduled alarm
      await this.runCheck(fullConfig);

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
    const nextAlarmAt = Date.now() + frequency;

    await this.ctx.storage.setAlarm(nextAlarmAt);
    await this.runCheck(config);

    this.setConfig({
      ...config,
      nextAlarmAt: new Date(nextAlarmAt).toISOString(),
    });
  }

  private async runCheck(config: Config): Promise<void> {
    const now = new Date().toISOString();
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
      alertStatus: newAlertStatus,
    });

    console.log("CHECK RESULT", now, config.url, checkResult);
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

  async destroy():Promise<void> {
    await this.ctx.storage.deleteAll();
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
      console.error("setConfig validation failed:", z.flattenError(parsed.error));
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
