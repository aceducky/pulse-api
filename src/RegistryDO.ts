import { DurableObject } from "cloudflare:workers";
import { drizzle, DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import { eq } from "drizzle-orm";
import migrations from "../drizzle/do_migrations/migrations";
import { registry } from "./db/do_storage/schemas/registryDo.schema";
import { Ok, Err, Result } from "./utils/result";
import { appError } from "./utils/errors";
import type { Frequency, InputConfig } from "./schemas/monitor.schema";

export class RegistryDO extends DurableObject<CloudflareBindings> {
  storage: DurableObjectStorage;
  db: DrizzleSqliteDODatabase<any>;

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.storage = ctx.storage;
    this.db = drizzle(this.storage, { logger: false });
    ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, migrations);
    });
  }

  async register(
    input: InputConfig,
  ): Promise<Result<typeof registry.$inferSelect>> {
    const alarmId = this.env.AlarmMakerDO.idFromName(input.url);
    const id = alarmId.toString();

    const inserted = await this.db
      .insert(registry)
      .values({
        id,
        name: input.name,
        url: input.url,
        frequency: input.frequency,
        status: "pending",
        alertOnLatencyMs: input.alertOnLatencyMs ?? null,
        alertOnStatusAbove: input.alertOnStatusAbove ?? null,
        alertOnBodyContains: input.alertOnBodyContains ?? null,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .returning();

    if (inserted.length === 0) {
      return Err(
        appError(
          409,
          "conflictErr",
          "A monitor with that name or URL already exists",
        ),
      );
    }

    const stub = this.env.AlarmMakerDO.get(alarmId);
    const startResult = await stub.start(input);

    if (!startResult.ok) {
      await this.db
        .update(registry)
        .set({ status: "alarm_failed" })
        .where(eq(registry.id, id));
      return Err(
        appError(
          500,
          "serverErr",
          "Registered, but alarm setup failed. Try deleting and recreating.",
        ),
      );
    }

    await this.db
      .update(registry)
      .set({ status: "active" })
      .where(eq(registry.id, id));

    return Ok({ ...inserted[0], status: "active" });
  }

  async list(): Promise<Result<(typeof registry.$inferSelect)[]>> {
    const rows = await this.db.select().from(registry);
    return Ok(rows);
  }

  async getMonitor(id: string): Promise<Result<typeof registry.$inferSelect>> {
    const rows = await this.db
      .select()
      .from(registry)
      .where(eq(registry.id, id));

    if (rows.length === 0) {
      return Err(appError(404, "notFoundErr", "Monitor not found"));
    }
    return Ok(rows[0]);
  }

  async setStatus(
    id: string,
    tobeActive: boolean,
  ): Promise<Result<{ msg: string }>> {
    const rows = await this.db
      .select()
      .from(registry)
      .where(eq(registry.id, id));

    if (rows.length === 0) {
      return Err(appError(404, "notFoundErr", "Monitor not found"));
    }

    const monitor = rows[0];

    if (tobeActive && monitor.status === "active") {
      return Err(appError(400, "clientErr", "Monitor is already active"));
    }
    if (!tobeActive && monitor.status === "stopped") {
      return Err(appError(400, "clientErr", "Monitor is already stopped"));
    }

    const stub = this.env.AlarmMakerDO.get(
      this.env.AlarmMakerDO.idFromString(id),
    );

    if (tobeActive) {
      const startResult = await stub.start({
        name: monitor.name,
        url: monitor.url,
        frequency: monitor.frequency,
        ...(monitor.alertOnLatencyMs && { alertOnLatencyMs: monitor.alertOnLatencyMs }),
        ...(monitor.alertOnStatusAbove && { alertOnStatusAbove: monitor.alertOnStatusAbove }),
        ...(monitor.alertOnBodyContains && { alertOnBodyContains: monitor.alertOnBodyContains }),
      });
      if (!startResult.ok) {
        return Err(startResult.error);
      }
    } else {
      await stub.stop();
    }

    await this.db
      .update(registry)
      .set({ status: tobeActive ? "active" : "stopped" })
      .where(eq(registry.id, id));

    return Ok({
      msg: `Monitor ${tobeActive ? "activated" : "stopped"}`,
    });
  }
  async setFrequency(id: string, frequency: Frequency): Promise<Result<{ msg: string }>> {
    const rows = await this.db
      .select()
      .from(registry)
      .where(eq(registry.id, id));

    if (rows.length === 0) {
      return Err(appError(404, "notFoundErr", "Monitor not found"));
    }

    const stub = this.env.AlarmMakerDO.get(
      this.env.AlarmMakerDO.idFromString(id),
    );
    const result = await stub.setFrequency(frequency);
    if (!result.ok) {
      return Err(result.error);
    }

    await this.db
      .update(registry)
      .set({ frequency })
      .where(eq(registry.id, id));

    return Ok({
      msg: "Frequency updated",
    });
  }

  async remove(id: string): Promise<Result<{ msg: string }>> {
    const rows = await this.db
      .select()
      .from(registry)
      .where(eq(registry.id, id));

    if (rows.length === 0) {
      return Err(appError(404, "notFoundErr", "Monitor not found"));
    }

    const stub = this.env.AlarmMakerDO.get(
      this.env.AlarmMakerDO.idFromString(id),
    );

    try {
      await stub.destroy();
    } catch (e) {
      console.error("Failed to destroy AlarmMakerDO during removal:", e);
      return Err(appError(500, "serverErr", "Failed to clean up alarm, monitor not deleted"));
    }

    await this.db.delete(registry).where(eq(registry.id, id));
    return Ok({ msg: "Monitor deleted" });
  }
}
