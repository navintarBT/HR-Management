const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGO_URI;
  await mongoose.connect(uri);
  console.log('[db] connected');
}

module.exports = connectDB;
