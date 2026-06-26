require('dotenv').config();
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const { connectDB } = require('./src/db/connection');
const jobRoutes = require('./src/api/routes/job.routes');

// Connect to MongoDB
connectDB();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/', (req, res) => {
  res.send('Hello World!');
}); 

app.use('/api', jobRoutes);

app.listen(port, () => {
  console.log(`TaskFlow API listening at http://localhost:${port}`);
});
