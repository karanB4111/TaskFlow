const logger = require('../../utils/logger');

function registerQueueLogging(queue) {
  queue.on('error', (error) => {
    logger.error('Queue error', {
      queue: queue.name,
      error,
    });
  });

  queue.on('waiting', (job) => {
    logger.debug('Job waiting in queue', {
      queue: queue.name,
      bullMqJobId: job?.id,
      type: job?.name,
    });
  });
}

module.exports = registerQueueLogging;
