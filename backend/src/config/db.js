const mongoose = require("mongoose");
const config = require("./env");

mongoose.set("strictQuery", true);

let listenersAttached = false;

function attachConnectionListeners() {
  if (listenersAttached) {
    return;
  }
  listenersAttached = true;

  mongoose.connection.on("error", (err) => {
    if (config.nodeEnv !== "test") {
      console.error("[FairTicket MongoDB] Connection error:", err.message);
    }
  });

  mongoose.connection.on("disconnected", () => {
    if (config.nodeEnv !== "test") {
      console.warn("[FairTicket MongoDB] Disconnected from MongoDB.");
    }
  });
}

async function connectDB() {
  attachConnectionListeners();

  // In production, autoIndex is disabled so indexes are built deliberately
  // during controlled maintenance/migration steps instead of on every startup.
  const autoIndex = config.nodeEnv !== "production";

  try {
    const connection = await mongoose.connect(config.mongodbUri, {
      serverSelectionTimeoutMS: 5000,
      autoIndex,
    });

    if (config.nodeEnv !== "test") {
      console.log(`MongoDB connected: ${connection.connection.name}`);
    }

    return connection;
  } catch (error) {
    const friendlyMessage = [
      `Could not connect to MongoDB (${error.message}).`,
      "MongoDB is probably not running locally on port 27017.",
      "Start MongoDB first:",
      "  • Linux (systemd): sudo systemctl start mongod",
      "  • macOS (Homebrew): brew services start mongodb-community",
      "  • Manual: mongod --dbpath ./mongo-data",
    ].join("\n");

    const connectionError = new Error(friendlyMessage);
    connectionError.cause = error;
    throw connectionError;
  }
}

async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

module.exports = {
  connectDB,
  disconnectDB,
};
