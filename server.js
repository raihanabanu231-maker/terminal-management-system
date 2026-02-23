require("dotenv").config();

const app = require("./src/app");
const http = require("http");
const { initWebSocketServer } = require("./src/gateway/socket.gateway");
const { startStatusJob } = require("./src/modules/device/device.controller");

// 3. Set the communication channel (Port 5000)
const PORT = process.env.PORT || 5000;

// 4. Create the actual server using the logic from app.js
const server = http.createServer(app);

// 5. Initialize WebSockets and Background Jobs
initWebSocketServer(server);
startStatusJob(); // Starts the Week 2 Status Normalization Job

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
