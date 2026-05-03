import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import {
  inputConfigSchema,
  idParamSchema,
  updateFrequencySchema,
} from "../schemas/monitor.schema";
import { validate } from "../utils/validator_wrapper";
import { errorResponse } from "../utils/errors";
import { createNeonDb } from "../db/neon";
import { checkLogs } from "../db/neon/schemas/logs.schema";
import z from "zod";

export const monitorRouter = new Hono<{ Bindings: CloudflareBindings }>();

function getRegistry(env: CloudflareBindings) {
  return env.RegistryDO.get(env.RegistryDO.idFromName("registry"));
}

monitorRouter.post("/", validate("json", inputConfigSchema), async (c) => {
  const data = c.req.valid("json");
  const registryStub = getRegistry(c.env);
  const result = await registryStub.register(data);
  if (!result.ok) {
    return errorResponse(c, result.error);
  }
  return c.json({ ok: true, data: result.data }, 201);
});

monitorRouter.get("/", async (c) => {
  const registryStub = getRegistry(c.env);
  const result = await registryStub.list();
  if (!result.ok) {
    return errorResponse(c, result.error);
  }
  return c.json({ ok: true, data: result.data }, 200);
});

monitorRouter.get("/:id", validate("param", idParamSchema), async (c) => {
  const { id } = c.req.valid("param");
  const registryStub = getRegistry(c.env);
  const result = await registryStub.getMonitor(id);
  if (!result.ok) {
    return errorResponse(c, result.error);
  }
  return c.json({ ok: true, data: result.data }, 200);
});

monitorRouter.delete("/:id", validate("param", idParamSchema), async (c) => {
  const { id } = c.req.valid("param");
  const registryStub = getRegistry(c.env);
  const result = await registryStub.remove(id);
  if (!result.ok) {
    return errorResponse(c, result.error);
  }
  return c.json({ ok: true, data: result.data }, 200);
});

monitorRouter.post(
  "/:id/acknowledge",
  validate("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const stub = c.env.AlarmMakerDO.get(c.env.AlarmMakerDO.idFromString(id));
    const result = await stub.acknowledgeAlert();
    if (!result.ok) {
      return errorResponse(c, result.error);
    }
    return c.json({ ok: true, data: result.data }, 200);
  },
);

monitorRouter.patch(
  "/:id/stop",
  validate("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const registryStub = getRegistry(c.env);
    const result = await registryStub.setStatus(id, false);
    if (!result.ok) {
      return errorResponse(c, result.error);
    }
    return c.json({ ok: true, data: result.data }, 200);
  },
);

monitorRouter.patch(
  "/:id/start",
  validate("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const registryStub = getRegistry(c.env);
    const result = await registryStub.setStatus(id, true);
    if (!result.ok) {
      return errorResponse(c, result.error);
    }
    return c.json({ ok: true, data: result.data }, 200);
  },
);

monitorRouter.patch(
  "/:id/frequency",
  validate("param", idParamSchema),
  validate("json", updateFrequencySchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { incomingFrequency } = c.req.valid("json");
    const registryStub = getRegistry(c.env);
    const result = await registryStub.setFrequency(id, incomingFrequency);
    if (!result.ok) {
      return errorResponse(c, result.error);
    }
    return c.json({ ok: true, data: result.data }, 200);
  },
);

monitorRouter.get(
  "/:id/status",
  validate("param", idParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const stub = c.env.AlarmMakerDO.get(c.env.AlarmMakerDO.idFromString(id));
    const result = await stub.getConfig();
    if (!result.ok) {
      return errorResponse(c, result.error);
    }
    return c.json({ ok: true, data: result.data }, 200);
  },
);

monitorRouter.get("/:id/logs", validate("param", idParamSchema), async (c) => {
  const { id } = c.req.valid("param");
  const limitParam = c.req.query("limit");
  const limit = Math.min(Number(limitParam) || 50, 200);

  try {
    const db = createNeonDb(c.env.DATABASE_URL);
    const logs = await db
      .select()
      .from(checkLogs)
      .where(eq(checkLogs.monitorId, id))
      .orderBy(desc(checkLogs.checkedAt))
      .limit(limit);

    return c.json({ ok: true, data: logs }, 200);
  } catch (e) {
    console.error("Failed to fetch logs from Neon:", e);
    return c.json(
      { ok: false, type: "serverErr", message: "Failed to fetch logs" },
      500,
    );
  }
});
