const pool = require("../../config/db");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { logAudit } = require("../../utils/audit");

// 1. Generate Enrollment Token (For Operator to show as QR)
// 1. Generate Enrollment Token (For Operator to show as QR)
exports.generateEnrollmentToken = async (req, res) => {
    const { serial_number, merchant_id } = req.body;
    const tenant_id = req.user.tenant_id;

    try {
        // Generate a random token
        const token = crypto.randomBytes(32).toString("hex");

        // Set expiry (e.g., 10 minutes from now)
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // Insert into DB
        await pool.query(
            `INSERT INTO devices (serial_number, enrollment_token, enrollment_token_expires, merchant_id, tenant_id, status)
             VALUES ($1, $2, $3, $4, $5, 'PENDING')
             ON CONFLICT (serial_number) 
             DO UPDATE SET enrollment_token = $2, enrollment_token_expires = $3, status = 'PENDING'`,
            [serial_number, token, expiresAt, merchant_id, tenant_id]
        );

        // Generate QR Code Data
        const qrData = JSON.stringify({
            token: token,
            tenant_id: tenant_id,
            expires_at: expiresAt
        });

        // Generate QR Code Image (Data URL)
        const qrCodeImage = await QRCode.toDataURL(qrData);

        res.json({
            success: true,
            message: "Enrollment Token & QR Code Generated",
            token: token,
            qr_code: qrCodeImage,
            expires_at: expiresAt
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
};

// 2. Enroll Device (Called by the Device itself when scanning QR)
exports.enrollDevice = async (req, res) => {
    const { enrollment_token, serial_number } = req.body;

    try {
        // Find device by token
        const result = await pool.query(
            "SELECT * FROM devices WHERE enrollment_token = $1 AND status = 'PENDING'",
            [enrollment_token]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ success: false, message: "Invalid or expired token" });
        }

        const device = result.rows[0];

        // Verify serial number matches (optional, but good for security)
        if (device.serial_number !== serial_number) {
            return res.status(400).json({ success: false, message: "Serial number mismatch" });
        }

        // Check expiry
        if (new Date() > new Date(device.enrollment_token_expires)) {
            return res.status(400).json({ success: false, message: "Token expired" });
        }

        // Generate long-lived Device Token (JWT)
        const jwt = require("jsonwebtoken");
        const deviceToken = jwt.sign(
            { id: device.id, role: "DEVICE", tenant_id: device.tenant_id },
            process.env.JWT_SECRET
        );

        // Generate Token Hash
        const tokenHash = crypto.createHash('sha256').update(deviceToken).digest('hex');

        // Activate Device and Store Token Hash
        await pool.query(
            "UPDATE devices SET status = 'ACTIVE', enrollment_token = NULL, device_token_hash = $2, last_seen = NOW() WHERE id = $1",
            [device.id, tokenHash]
        );

        // Audit Log
        await logAudit("device.enroll", null, device.id, "DEVICE", { serial_number: device.serial_number }, req.ip);

        res.json({
            success: true,
            message: "Device Enrolled Successfully",
            device_token: deviceToken
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
};

// 3. Send Remote Command (Flow 5)
exports.sendDeviceCommand = async (req, res) => {
    const { deviceId } = req.params;
    const { command_type, payload } = req.body;
    const tenant_id = req.user.tenant_id;

    try {
        // 1. Verify Device Ownership
        const deviceRes = await pool.query(
            "SELECT * FROM devices WHERE id = $1 AND tenant_id = $2",
            [deviceId, tenant_id]
        );

        if (deviceRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Device not found" });
        }

        const device = deviceRes.rows[0];

        // 2. Insert Command into DB (Status: QUEUED)
        const cmdRes = await pool.query(
            `INSERT INTO commands (device_id, command_type, payload, status, sent_at)
             VALUES ($1, $2, $3, 'QUEUED', NULL)
             RETURNING *`,
            [deviceId, command_type, payload ? JSON.stringify(payload) : null]
        );

        const command = cmdRes.rows[0];

        // Audit Log: Command Queued
        await logAudit("command.send", req.user.id, deviceId, "DEVICE", { command: command_type, command_id: command.id }, req.ip);

        // 3. Push Command via WebSocket
        // We require the gateway function dynamically to avoid circular dependencies if any, though here it's fine.
        const { sendCommand } = require("../../gateway/socket.gateway");

        const success = sendCommand(device.id, {
            type: "command",
            id: command.id,
            cmd: command_type,
            payload: payload
        });

        if (success) {
            // Update Status to SENT
            await pool.query(
                "UPDATE commands SET status = 'SENT', sent_at = NOW() WHERE id = $1",
                [command.id]
            );
            res.json({ success: true, message: "Command Sent", command_id: command.id });
        } else {
            // Device Offline -> Remains QUEUED (Retry logic defined in Flow 5 failure handling)
            res.json({ success: true, message: "Command Queued (Device Offline)", command_id: command.id });
        }

    } catch (error) {
        console.error("Command Error:", error);
        res.status(500).json({ message: "Server error" });
    }
};
