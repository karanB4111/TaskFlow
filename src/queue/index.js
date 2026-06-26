const emailQueue = require("./emailQueue");
const imageQueue = require("./imageQueue");
const reportQueue = require("./reportQueue");

const queues = {
  email: emailQueue,
  image: imageQueue,
  report: reportQueue,
};

const getQueueByType = (type) => {
  const queue = queues[type];

  if (!queue) {
    const error = new Error(`Unknown job type: ${type}`);
    error.code = "UNKNOWN_JOB_TYPE";
    throw error;
  }

  return queue;
};

module.exports = { getQueueByType };
