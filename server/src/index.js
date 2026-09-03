import { createSocialServer } from "./app.js";

const runtime = createSocialServer();
const port = Number(process.env.PORT ?? process.env.SOCIAL_PORT ?? 18080);
const host = process.env.HOST ?? "0.0.0.0";

runtime.server.listen(port, host, () => {
  console.log(`[xiaoman-social] listening on ${host}:${port}`);
});

const shutdown = async (signal) => {
  console.log(`[xiaoman-social] ${signal}`);
  await runtime.close();
  process.exit(0);
};

process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdown("SIGINT"); });
