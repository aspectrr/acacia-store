import { app } from "./src/index.js";

// Simple entry point that starts the server
const port = parseInt(process.env.PORT || "3000");
const host = process.env.HOST || "localhost";

console.log(`🚀 Starting Acacia Extension Store...`);
console.log(`🔗 Server will run at http://${host}:${port}`);

// Start the server using Bun's built-in server
export default {
  port,
  hostname: host,
  fetch: app.fetch,
};
