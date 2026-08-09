import { buildApp } from "./bootstrap/app";
import { env } from "./config/env";

async function main(): Promise<void> {
  const app = await buildApp();

  try {
    await app.listen({
      host: env.host,
      port: env.port
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
