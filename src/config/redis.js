const Redis = require("ioredis");
const logger = require("../utils/logger");

const redisConnection = {
    host : process.env.REDIS_HOST || "127.0.0.1",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    maxRetriesPerRequest: null,
}

const redis = new Redis(redisConnection);

redis.on("ready", () => logger.info("Redis is ready", {
    host: redisConnection.host,
    port: redisConnection.port,
}) );

redis.on("error", (error) => logger.error("Redis connection error", { error }));

redis.on("reconnecting", (delay) => logger.warn("Redis reconnecting", { delayMs: delay }));

redis.on("end", () => logger.warn("Redis connection ended"));

module.exports = {
    redis,
    redisConnection
};
