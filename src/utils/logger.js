const fs = require('fs');
const path = require('path');
const { createLogger, format, transports } = require('winston');

const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
const logFormat = process.env.LOG_FORMAT || (process.env.NODE_ENV === 'production' ? 'json' : 'pretty');

fs.mkdirSync(logDir, { recursive: true });

const redactKeys = new Set(['password', 'pass', 'token', 'secret', 'authorization', 'apikey', 'api_key']);

function redact(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(redact);
  }

  return Object.entries(value).reduce((safeValue, [key, entryValue]) => {
    safeValue[key] = redactKeys.has(key.toLowerCase()) ? '[REDACTED]' : redact(entryValue);
    return safeValue;
  }, {});
}

const addSafeMetadata = format((info) => {
  for (const key of Object.keys(info)) {
    if (['level', 'message', 'timestamp', 'stack', 'service'].includes(key)) {
      continue;
    }

    info[key] = redactKeys.has(key.toLowerCase()) ? '[REDACTED]' : redact(info[key]);
  }

  return info;
});

const consoleFormat = format.printf((info) => {
  const { timestamp, level, message, service, stack, ...metadata } = info;
  const meta = Object.keys(metadata).length ? ` ${JSON.stringify(metadata)}` : '';
  return `${timestamp} ${level} [${service}] ${message}${stack ? ` ${stack}` : ''}${meta}`;
});

const baseFormats = [
  format.timestamp(),
  format.errors({ stack: true }),
  addSafeMetadata(),
];

const logger = createLogger({
  level: logLevel,
  defaultMeta: {
    service: process.env.SERVICE_NAME || 'taskflow',
  },
  format: format.combine(...baseFormats, format.json()),
  transports: [
    new transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
    new transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
  exitOnError: false,
});

if (process.env.NODE_ENV !== 'test') {
  logger.add(new transports.Console({
    format: logFormat === 'json'
      ? format.combine(...baseFormats, format.json())
      : format.combine(...baseFormats, format.colorize(), consoleFormat),
  }));
}

module.exports = logger;
