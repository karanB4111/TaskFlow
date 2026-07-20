const { Queue } = require("bullmq");
const {redisConnection} = require("../../config/redis");
const registerQueueLogging = require("./queueLogging");

const emailQueue = new Queue("email", {
    connection : redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 1000,
        },
        removeOnComplete: false,
        removeOnFail: false,
    },
});

registerQueueLogging(emailQueue);

module.exports = emailQueue;
