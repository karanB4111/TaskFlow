const { Queue } = require("bullmq");
const connection = require("../config/redis");

const reportQueue = new Queue("report", {
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

module.exports = reportQueue;
