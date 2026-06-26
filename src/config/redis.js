const Redis = require("ioredis");

const redisUrl =
    process.env.REDIS_URL ||
    process.env.REDIS_URI ||
    "redis://127.0.0.1:6379";

const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
});

redis.on("ready", () => {
    console.log("Redis is ready");
});

redis.on("error", (error) => {
    console.error("Redis connection error:", error.message);
});

redis.on("reconnecting", (delay) => {
    console.log(`Redis reconnecting in ${delay}ms`);
});

redis.on("end", () => {
    console.log("Redis connection ended");
});

module.exports = redis;
