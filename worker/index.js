require("dotenv").config();
const emailWorker = require("../src/queue/workers/emailWorker");
const imageWorker = require("../src/queue/workers/imageWorker");
const reportWorker = require("../src/queue/workers/reportWorker");
const {connectDB} = require("../src/db/connection");
const { redis } = require("../src/config/redis");
const logger = require("../src/utils/logger");
const registerProcessLogging = require("../src/utils/processLogging");

async function start(){
    await connectDB();

    logger.info("Workers started", {
        workers: [emailWorker.name, imageWorker.name, reportWorker.name],
    });
}

async function shutdown(signal = "shutdown", exitCode = 0) {
    logger.info("Shutting down workers", { signal });

    await Promise.all([
        emailWorker.close(),
        imageWorker.close(),
        reportWorker.close(),
        redis.quit(),
    ]);

    logger.info("Workers stopped");
    process.exit(exitCode);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
registerProcessLogging(logger, shutdown);

start();
