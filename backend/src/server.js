const config = require("./config/env");
const { connectDB, disconnectDB } = require("./config/db");
const app = require("./app");

async function startServer() {
  await connectDB();

  const server = app.listen(config.port, () => {
    console.log(
      `FairTicket backend listening on http://localhost:${config.port} (${config.nodeEnv})`
    );
    console.log(
      `Health check: http://localhost:${config.port}/api/v1/health`
    );
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[FairTicket] Unhandled Promise Rejection:", reason);
    server.close(async () => {
      await disconnectDB().catch(() => {});
      process.exit(1);
    });
  });

  process.on("uncaughtException", (error) => {
    console.error("[FairTicket] Uncaught Exception:", error);
    server.close(async () => {
      await disconnectDB().catch(() => {});
      process.exit(1);
    });
  });
}

startServer().catch((error) => {
  console.error("[FairTicket] Failed to start backend server:\n", error.message);
  process.exit(1);
});
