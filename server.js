require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const app = express();
const httpServer = http.createServer(app);
const port = process.env.PORT || 3000;
const { connectDB } = require('./src/db/connection');
const jobRoutes = require('./src/api/routes/job.routes');
const requestLogger = require('./src/api/middleware/requestLogger.middleware');
const errorLogger = require('./src/api/middleware/errorLogger.middleware');
const logger = require('./src/utils/logger');
const registerProcessLogging = require('./src/utils/processLogging');
const {initSocket, getSocket} = require('./src/socket/socket'); // Initialize socket.io with the HTTP server
const { initSocketBridge, closeSocketBridge } = require('./src/queue/events/socketBridge');

// Connect to MongoDB
connectDB();

initSocket(httpServer); // Initialize socket.io with the HTTP server

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(requestLogger);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));

app.get('/', (req, res) => {
  res.send('Hello World!');
}); 

app.use('/api', jobRoutes);
app.use(errorLogger);

// const server = app.listen(port, () => {
//   logger.info('TaskFlow API listening', {
//     port,
//     url: `http://localhost:${port}`,
//     environment: process.env.NODE_ENV || 'development',
//   });
// });

async function start() {
  try {
    await initSocketBridge();

    httpServer.listen(port, () => {
      logger.info('TaskFlow API listening', {
        port,
        url: `http://localhost:${port}`,
        environment: process.env.NODE_ENV || 'development',
      });
    });
  } catch (error) {
    logger.error('Unable to start API server', { error });
    process.exit(1);
  }
}

async function shutdown(signal = 'shutdown', exitCode = 0) {
  logger.info('Shutting down API server', { signal });

  await closeSocketBridge();

  httpServer.close((error) => {
    if (error) {
      logger.error('Error while closing API server', { error });
      process.exit(1);
    }

    logger.info('API server stopped');
    process.exit(exitCode);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
registerProcessLogging(logger, shutdown);

start();
