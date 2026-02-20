const WebSocket = require('ws');
const crypto = require('crypto');
const pool = require('../config/db');

// In-memory map of connected devices: deviceId -> WebSocket
const connectedDevices = new Map();

function initWebSocketServer(server) {
    const wss = new WebSocket.Server({ server });

    wss.on('connection', async (ws, req) => {
        try {
            // 1. Authenticate Device
            const url = new URL(req.url, `http://${req.headers.host}`);
            const token = url.searchParams.get('token'); // Simplest for now: ws://host?token=...

            if (!token) {
                ws.close(1008, "Token Required"); // Policy Violation
                return;
            }

            // Hash the token to compare with DB
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

            const result = await pool.query(
                "SELECT * FROM devices WHERE device_token_hash = $1 AND status = 'ACTIVE'",
                [tokenHash]
            );

            if (result.rows.length === 0) {
                ws.close(1008, "Invalid Token");
                return;
            }

            const device = result.rows[0];
            const deviceId = device.id;

            // 2. Register Connection
            connectedDevices.set(deviceId, ws);
            console.log(`Device Connected: ${device.serial_number} (ID: ${deviceId})`);

            // 3. Mark as Online immediately
            await pool.query("UPDATE devices SET last_seen = NOW() WHERE id = $1", [deviceId]);

            // 4. Handle Messages (Heartbeat, Command ACKs)
            ws.on('message', async (message) => {
                try {
                    const data = JSON.parse(message);

                    if (data.type === 'heartbeat') {
                        // Update Last Seen
                        await pool.query("UPDATE devices SET last_seen = NOW() WHERE id = $1", [deviceId]);
                        // Optional: ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
                    }
                    else if (data.ack) {
                        // Handle Command Acknowledgement (Flow 5)
                        await pool.query(
                            "UPDATE commands SET status = 'ACKNOWLEDGED', acked_at = NOW() WHERE id = $1 AND device_id = $2",
                            [data.ack, deviceId] // data.ack should be command ID (or correlation ID)
                        );
                        console.log(`Command ${data.ack} acknowledged by Device ${deviceId}`);
                    }

                } catch (err) {
                    console.error("WebSocket Message Error:", err);
                }
            });

            // 5. Handle Disconnect
            ws.on('close', () => {
                connectedDevices.delete(deviceId);
                console.log(`Device Disconnected: ${device.serial_number} (ID: ${deviceId})`);
            });

        } catch (error) {
            console.error("WebSocket Connection Error:", error);
            ws.close(1011, "Internal Error");
        }
    });

    console.log("WebSocket Gateway Initialized");
    return wss;
}

// Function to send command to a specific device (For Flow 5)
function sendCommand(deviceId, command) {
    const ws = connectedDevices.get(deviceId);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(command));
        return true;
    }
    return false;
}

module.exports = { initWebSocketServer, sendCommand };
