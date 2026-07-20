const logger = require('../../utils/logger');

function errorLogger(err, req, res, next) {
  logger.error('Unhandled request error', {
    error: err,
    method: req.method,
    path: req.originalUrl || req.url,
  });

  if (res.headersSent) {
    return next(err);
  }

  return res.status(500).json({
    success: false,
    message: 'Internal server error',
  });
}

module.exports = errorLogger;
