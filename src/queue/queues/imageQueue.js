const { Queue } = require("bullmq");
const {redisConnection} = require("../../config/redis");
const registerQueueLogging = require("./queueLogging");

const imageQueue = new Queue("image", {
    connection : redisConnection,
    defaultJobOptions: {
        attempts: 2,
        backoff: {
            type: "exponential",
            delay: 1000,
        },
        removeOnComplete: false,
        removeOnFail: false,
    },
});

registerQueueLogging(imageQueue);

module.exports = imageQueue;
