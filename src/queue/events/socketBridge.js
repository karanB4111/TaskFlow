const { QueueEvents } = require('bullmq');
const { redisConnection } = require('../../config/redis');
const { getSocket } = require('../../socket/socket');
const logger = require('../../utils/logger');

const QUEUE_NAMES = ['email', 'image', 'report'];

let queueEvents = [];

function getPublicJobId(queueName, bullMqJobId) {
  return `${queueName}:${bullMqJobId}`;
}

function emitToJobRoom(queueName, bullMqJobId, eventName, payload = {}) {
  const jobId = getPublicJobId(queueName, bullMqJobId);

  getSocket().to(`job:${jobId}`).emit(eventName, {
    jobId,
    type: queueName,
    ...payload,
  });

  logger.debug('Socket event emitted', { eventName, jobId });
}

function registerQueueEventHandlers(events, queueName) {
  events.on('active', ({ jobId }) => {
    emitToJobRoom(queueName, jobId, 'job:active');
  });

  events.on('progress', ({ jobId, data }) => {
    emitToJobRoom(queueName, jobId, 'job:progress', { progress: data });
  });

  events.on('completed', ({ jobId, returnvalue }) => {
    emitToJobRoom(queueName, jobId, 'job:completed', { result: returnvalue });
  });

  events.on('failed', ({ jobId, failedReason }) => {
    emitToJobRoom(queueName, jobId, 'job:failed', { reason: failedReason });
  });

  events.on('error', (error) => {
    logger.error('QueueEvents bridge error', { queue: queueName, error });
  });
}

async function initSocketBridge() {
  if (queueEvents.length > 0) {
    return queueEvents;
  }

  const listeners = QUEUE_NAMES.map((queueName) => {
    const events = new QueueEvents(queueName, { connection: redisConnection });
    registerQueueEventHandlers(events, queueName);
    return events;
  });

  try {
    await Promise.all(listeners.map((events) => events.waitUntilReady()));
    queueEvents = listeners;
    logger.info('Socket event bridge ready', { queues: QUEUE_NAMES });
    return queueEvents;
  } catch (error) {
    await Promise.allSettled(listeners.map((events) => events.close()));
    logger.error('Socket event bridge failed to start', { error });
    throw error;
  }
}

async function closeSocketBridge() {
  await Promise.all(queueEvents.map((events) => events.close()));
  queueEvents = [];
  logger.info('Socket event bridge stopped');
}

module.exports = {
  initSocketBridge,
  closeSocketBridge,
};
