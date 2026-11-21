const mongoose = require("mongoose");

const DEFAULT_TEST_URI = "mongodb://127.0.0.1:27017/fairticket_test";

async function connectTestDb() {
  const uri = process.env.MONGODB_TEST_URI || DEFAULT_TEST_URI;
  if (!uri.toLowerCase().includes("test")) {
    throw new Error(
      `Refusing to run destructive test cleanup against non-test database URI: ${uri}`
    );
  }
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
  }
  await mongoose.connection.syncIndexes();
}

async function clearTestDb() {
  if (mongoose.connection.readyState !== 1) {
    return;
  }
  const collections = await mongoose.connection.db.collections();
  for (const collection of collections) {
    // Use raw MongoDB driver deleteMany so append-only Mongoose hooks on
    // SecurityLog and TicketHistory do not block test cleanup.
    await collection.deleteMany({});
  }
}

async function disconnectTestDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

module.exports = {
  connectTestDb,
  clearTestDb,
  disconnectTestDb,
};
