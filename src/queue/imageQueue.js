const { Queue } = require("bullmq");
const connection = require("../config/redis");

const imageQueue = new Queue("image", {
    connection,
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

module.exports = imageQueue;
