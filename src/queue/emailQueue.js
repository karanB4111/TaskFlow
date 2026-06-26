const { Queue } = require("bullmq");
const connection = require("../config/redis");

const emailQueue = new Queue("email", {
    connection,
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

module.exports = emailQueue;
