const { Queue } = require("bullmq");
const {redisConnection} = require("../../config/redis");
const registerQueueLogging = require("./queueLogging");

const reportQueue = new Queue("report", {
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

registerQueueLogging(reportQueue);

module.exports = reportQueue;
