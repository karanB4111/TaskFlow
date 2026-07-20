function registerProcessLogging(logger, shutdown) {
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { error: reason });
  });

  process.on('uncaughtException', async (error) => {
    logger.error('Uncaught exception', { error });

    if (typeof shutdown === 'function') {
      await shutdown('uncaughtException', 1);
      return;
    }

    process.exit(1);
  });
}

module.exports = registerProcessLogging;
