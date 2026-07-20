const logger = require('../../utils/logger');

function getJobMetadata(job) {
  if (!job) {
    return {};
  }

  return {
    jobId: `${job.name}:${job.id}`,
    bullMqJobId: job.id,
    type: job.name,
    attemptsMade: job.attemptsMade,
  };
}

function registerWorkerLogging(worker) {
  worker.on('active', (job) => {
    logger.debug('Job processing started', getJobMetadata(job));
  });

  worker.on('completed', (job, result) => {
    logger.info('Job completed', {
      ...getJobMetadata(job),
      result,
    });
  });

  worker.on('failed', (job, error) => {
    logger.warn('Job failed', {
      ...getJobMetadata(job),
      error,
      failedReason: error?.message,
    });
  });

  worker.on('stalled', (jobId) => {
    logger.warn('Job stalled', {
      worker: worker.name,
      bullMqJobId: jobId,
    });
  });

  worker.on('error', (error) => {
    logger.error('Worker error', {
      worker: worker.name,
      error,
    });
  });
}

module.exports = registerWorkerLogging;
