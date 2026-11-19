#!/usr/bin/env -S deno run --allow-env --allow-net --allow-read --allow-run --allow-write
import { AppController } from "./src/app.ts";
import { Logger } from "./src/logger.ts";

if (import.meta.main) {
  const logger = new Logger();
  const controller = new AppController(logger);

  try {
    await controller.start();
  } catch (error) {
    logger.error("Application startup failed", error);
    console.error(error);
    Deno.exit(1);
  }
}
