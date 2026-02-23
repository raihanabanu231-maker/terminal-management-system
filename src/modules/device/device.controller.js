const pool = require("../../config/db");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { logAudit } = require("../../utils/audit");

// 1. Generate Enrollment Token
exports.generateEnrollmentToken = async (req, res) => {
    const { serial, merchant_id, model } = req.body;
    const tenant_id = req.user.tenant_id;

    try {
        const token = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // In the new schema, we store the hash of the enrollment token for security
        await pool.query(
            `INSERT INTO devices (serial, model, enrollment_token, enrollment_token_expires, merchant_id, tenant_id, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending_onboard')
             ON CONFLICT (serial) 
             DO UPDATE SET enrollment_token = $3, enrollment_token_expires = $4, status = 'pending_onboard'`,
            [serial, model || 'Standard', tokenHash, expiresAt, merchant_id || null, tenant_id]
        );

        const qrData = JSON.stringify({ token: token, tenant_id: tenant_id, serial: serial });
        const qrCodeImage = await QRCode.toDataURL(qrData);

        res.json({
            success: true,
            token: token,
            qr_code: qrCodeImage,
            expires_at: expiresAt
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
};

// 2. Enroll Device
exports.enrollDevice = async (req, res) => {
    const { token, serial } = req.body;

    try {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

        const result = await pool.query(
            "SELECT * FROM devices WHERE enrollment_token = $1 AND status = 'pending_onboard'",
            [tokenHash]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ success: false, message: "Invalid token" });
        }

        const device = result.rows[0];

        if (new Date() > new Date(device.enrollment_token_expires)) {
            return res.status(400).json({ success: false, message: "Token expired" });
        }

        const jwt = require("jsonwebtoken");
        const deviceToken = jwt.sign(
            { id: device.id, role: "DEVICE", tenant_id: device.tenant_id },
            process.env.JWT_SECRET
        );

        const deviceTokenHash = crypto.createHash('sha256').update(deviceToken).digest('hex');

        await pool.query(
            `UPDATE devices 
             SET status = 'active', 
                 enrollment_token = NULL, 
                 enrollment_token_used = $1, 
                 device_token_hash = $2, 
                 last_seen = NOW() 
             WHERE id = $3`,
            [tokenHash, deviceTokenHash, device.id]
        );

        await logAudit(device.tenant_id, null, "device.enroll", "DEVICE", device.id, { serial: device.serial });

        res.json({
            success: true,
            device_token: deviceToken
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
};

// 3. Remote Command
exports.sendDeviceCommand = async (req, res) => {
    const { deviceId } = req.params;
    const { type, payload } = req.body;
    const tenant_id = req.user.tenant_id;

    try {
        const deviceRes = await pool.query(
            "SELECT id, tenant_id FROM devices WHERE id = $1 AND tenant_id = $2",
            [deviceId, tenant_id]
        );

        if (deviceRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Device not found" });
        }

        const cmdRes = await pool.query(
            `INSERT INTO commands (device_id, type, payload, status, created_by)
             VALUES ($1, $2, $3, 'queued', $4)
             RETURNING id`,
            [deviceId, type, payload || {}, req.user.id]
        );

        const commandId = cmdRes.rows[0].id;

        await logAudit(tenant_id, req.user.id, "command.send", "DEVICE", deviceId, { type, command_id: commandId });

        const { sendCommand } = require("../../gateway/socket.gateway");
        const success = sendCommand(deviceId, {
            type: "command",
            id: commandId,
            cmd: type,
            payload: payload
        });

        if (success) {
            await pool.query("UPDATE commands SET status = 'sent', sent_at = NOW() WHERE id = $1", [commandId]);
            res.json({ success: true, command_id: commandId });
        } else {
            res.json({ success: true, message: "Queued (Device Offline)", command_id: commandId });
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
};
// 4. Device Command Polling (The "Pull" fallback for Week 2)
exports.getPendingCommands = async (req, res) => {
    const deviceId = req.user.id; // User is the DEVICE itself in this context

    try {
        const result = await pool.query(
            "SELECT id, type, payload FROM commands WHERE device_id = $1 AND status = 'queued' ORDER BY created_at ASC",
            [deviceId]
        );

        // Update status to 'sent' once pulled
        if (result.rows.length > 0) {
            const ids = result.rows.map(r => r.id);
            await pool.query(
                "UPDATE commands SET status = 'sent', sent_at = NOW() WHERE id = ANY($1)",
                [ids]
            );
        }

        res.json({
            success: true,
            commands: result.rows
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
};

// 5. Status Normalization Job (Week 2 logic)
// This runs in the background and marks devices as OFFLINE if silent for > 5 mins
exports.startStatusJob = () => {
    setInterval(async () => {
        try {
            await pool.query(
                "UPDATE devices SET status = 'offline' WHERE last_seen < NOW() - INTERVAL '5 minutes' AND status = 'active'"
            );
        } catch (error) {
            console.error("Status Job Error:", error);
        }
    }, 60000); // Check every minute
};

// 6. Data Retention Cleanup Job (Week 3 logic)
// Cleans up telemetry and audit logs older than 30 days
exports.startCleanupJob = () => {
    setInterval(async () => {
        try {
            await pool.query("DELETE FROM device_telemetry WHERE created_at < NOW() - INTERVAL '30 days'");
            console.log("🛠️ Data Retention Cleanup completed.");
        } catch (error) {
            console.error("Cleanup Job Error:", error);
        }
    }, 24 * 60 * 60 * 1000); // Run once every 24 hours
};
