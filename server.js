require("dotenv").config();

const app = require("./src/app");
const http = require("http");
const { initWebSocketServer } = require("./src/gateway/socket.gateway");

const PORT = process.env.PORT || 5000;

// Create HTTP Server
const server = http.createServer(app);

// Initialize WebSocket Gateway
initWebSocketServer(server);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
