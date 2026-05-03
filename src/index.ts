import { Hono } from "hono";
import { monitorRouter } from "./routes/monitor.route";
import { logger } from "hono/logger";

const app = new Hono<{ Bindings: CloudflareBindings }>();
app.use(logger());

app.get("/", (c) => {
  return c.text("Pulse API");
});

app.route("/api/monitors", monitorRouter);

export { AlarmMakerDO } from "./AlarmMakerDO";
export { RegistryDO } from "./RegistryDO";
export default app;
