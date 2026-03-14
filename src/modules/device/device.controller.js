const pool = require("../../config/db");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { logAudit } = require("../../utils/audit");

// 1. Generate Enrollment Token (Pre-Registration)
exports.generateEnrollmentToken = async (req, res) => {
    const { serial, model, merchant_id, tenant_id } = req.body;

    // A device serial is required to track the hardware
    if (!serial) {
        return res.status(400).json({ success: false, message: "Device serial number is required" });
    }

    const finalTenantId = (req.user.role === "SUPER_ADMIN" && tenant_id)
        ? tenant_id
        : req.user.tenant_id;

    if (!finalTenantId) {
        return res.status(400).json({ success: false, message: "tenant_id is required" });
    }

    try {
        // If merchant_id is provided, verify it belongs to the same tenant
        if (merchant_id) {
            const merchRes = await pool.query("SELECT id FROM merchants WHERE id = $1 AND tenant_id = $2", [merchant_id, finalTenantId]);
            if (merchRes.rows.length === 0) {
                return res.status(404).json({ success: false, message: "Merchant not found or does not belong to this tenant" });
            }
        }
        const token = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // In the new schema, we store the hash of the enrollment token for security
        await pool.query(
            `INSERT INTO devices (serial, model, enrollment_token, merchant_id, tenant_id, status)
             VALUES ($1, $2, $3, $4, $5, 'pending_onboard')
             ON CONFLICT (serial) 
             DO UPDATE SET enrollment_token = $3, status = 'pending_onboard'`,
            [serial, model || 'Standard', tokenHash, merchant_id || null, finalTenantId]
        );

        const qrData = JSON.stringify({ token: token, tenant_id: finalTenantId, serial: serial });
        const qrCodeImage = await QRCode.toDataURL(qrData);

        res.json({
            success: true,
            token: token,
            qr_code: qrCodeImage,
            expires_at: expiresAt
        });
    } catch (error) {
        console.error("GENERATE ENROLLMENT TOKEN ERROR:", error);
        res.status(500).json({ message: "Server error", detail: error.message });
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
        let sql = "SELECT id, tenant_id FROM devices WHERE id = $1";
        const params = [deviceId];

        if (req.user.role !== "SUPER_ADMIN") {
            sql += " AND tenant_id = $2";
            params.push(req.user.tenant_id);
        }

        const deviceRes = await pool.query(sql, params);

        if (deviceRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Device not found" });
        }

        const device = deviceRes.rows[0];

        const cmdRes = await pool.query(
            `INSERT INTO commands (device_id, type, payload, status, created_by, expires_at)
             VALUES ($1, $2, $3, 'queued', $4, NOW() + INTERVAL '24 hours')
             RETURNING id`,
            [deviceId, type, payload || {}, req.user.id]
        );

        const commandId = cmdRes.rows[0].id;

        await logAudit(device.tenant_id, req.user.id, "command.send", "DEVICE", deviceId, { type, command_id: commandId });

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

// 4.5. Device Command ACK (Device confirms it executed the command)
exports.ackCommand = async (req, res) => {
    const { commandId } = req.params;
    const { success, error_message, result_data } = req.body;
    const deviceId = req.user.id; // User is the DEVICE itself in this context

    try {
        const cmdRes = await pool.query(
            "SELECT * FROM commands WHERE id = $1 AND device_id = $2",
            [commandId, deviceId]
        );

        if (cmdRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Command not found or unauthorized" });
        }

        const cmd = cmdRes.rows[0];

        if (success) {
            await pool.query(
                `UPDATE commands 
                 SET status = 'completed', acked_at = NOW(), payload = payload || $1::jsonb 
                 WHERE id = $2`,
                [JSON.stringify({ result_data }), commandId]
            );
        } else {
            if (cmd.retry_count < cmd.max_retries) {
                await pool.query(
                    `UPDATE commands 
                     SET status = 'queued', retry_count = retry_count + 1, payload = payload || $1::jsonb 
                     WHERE id = $2`,
                    [JSON.stringify({ last_error_message: error_message }), commandId]
                );
            } else {
                await pool.query(
                    `UPDATE commands 
                     SET status = 'failed', acked_at = NOW(), payload = payload || $1::jsonb 
                     WHERE id = $2`,
                    [JSON.stringify({ result_data, error_message, final_failure: true }), commandId]
                );
            }
        }

        res.json({ success: true, message: "Command acknowledged successfully" });

    } catch (error) {
        console.error("ACK ERROR:", error);
        res.status(500).json({ success: false, message: "Server error", detail: error.message });
    }
};

// 5. Get All Devices (For Dashboard/List)
exports.getDevices = async (req, res) => {
    const { merchant_id, tenant_id } = req.query;
    const userRole = req.user.role;

    try {
        let query = "SELECT d.*, m.name as merchant_name, t.name as tenant_name FROM devices d ";
        query += "JOIN tenants t ON d.tenant_id = t.id ";
        query += "LEFT JOIN merchants m ON d.merchant_id = m.id ";
        query += "WHERE d.deleted_at IS NULL";

        const params = [];

        // Hierarchy Filtering Logic
        if (userRole === "SUPER_ADMIN") {
            if (tenant_id) {
                params.push(tenant_id);
                query += ` AND d.tenant_id = $${params.length}`;
            }
        } else {
            // All non-super-admins are locked to their own tenant
            params.push(req.user.tenant_id);
            query += ` AND d.tenant_id = $${params.length}`;

            // 🎯 NEW: Merchant Scoping
            // Check if user has a merchant scope in their JWT
            const merchantRole = req.user.roles?.find(r => r.scope === 'merchant');
            if (merchantRole) {
                params.push(merchantRole.scope_id);
                query += ` AND d.merchant_id IN (
                    SELECT id FROM merchants 
                    WHERE path LIKE (SELECT path FROM merchants WHERE id = $${params.length}) || '%'
                )`;
            }
        }

        if (merchant_id) {
            params.push(merchant_id);
            query += ` AND d.merchant_id = $${params.length}`;
        }

        const result = await pool.query(query, params);
        res.json({
            success: true,
            total: result.rows.length,
            data: result.rows
        });
    } catch (error) {
        console.error("GetDevices Error:", error);
        res.status(500).json({ message: "Server error", detail: error.message });
    }
};

// 5. Get Single Device (For Detail Page)
exports.getDeviceById = async (req, res) => {
    const { id } = req.params;
    const { tenant_id, role } = req.user;

    try {
        const result = await pool.query(
            `SELECT d.*, m.name as merchant_name, t.name as tenant_name 
             FROM devices d
             JOIN tenants t ON d.tenant_id = t.id
             LEFT JOIN merchants m ON d.merchant_id = m.id
             WHERE d.id = $1 AND d.deleted_at IS NULL`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Device not found" });
        }

        const device = result.rows[0];

        // Authorization Scoping
        if (role !== "SUPER_ADMIN" && device.tenant_id !== tenant_id) {
            return res.status(403).json({ success: false, message: "Unauthorized access to device in different tenant" });
        }

        res.json({ success: true, data: device });
    } catch (error) {
        console.error("GetDeviceById Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// 5. Receive Device Heartbeat (Telemetry Ping)
exports.receiveHeartbeat = async (req, res) => {
    // Note: This endpoint is protected by authorizeRoles("DEVICE"), which means
    // req.user.id is securely populated from the device's JWT token, NOT the request body.
    const deviceId = req.user.id;
    const { battery_level, app_version, network_type, metadata } = req.body;

    try {
        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            // 1. Insert the exact telemetry ping into the audit/heartbeat table
            await client.query(
                `INSERT INTO device_heartbeats (device_id, battery_level, app_version, network_type, metadata)
                 VALUES ($1, $2, $3, $4, $5)`,
                [deviceId, battery_level || null, app_version || null, network_type || null, metadata || {}]
            );

            // 2. Update the parent device record to mark it as currently "Online"
            await client.query(
                `UPDATE devices SET last_seen = NOW() WHERE id = $1`,
                [deviceId]
            );

            await client.query("COMMIT");
            res.json({ success: true, message: "Heartbeat acknowledged" });

        } catch (txnError) {
            await client.query("ROLLBACK");
            throw txnError;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error("HEARTBEAT ERROR:", error);
        res.status(500).json({ success: false, message: "Server error", detail: error.message });
    }
};

// 6. Status Normalization Job (Week 2 logic)
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

// 7. Command Expiry Job (Week 2 logic)
// Cleans up stuck commands that have exceeded their 24hr expiration window
exports.startExpiryJob = () => {
    setInterval(async () => {
        try {
            const res = await pool.query("UPDATE commands SET status = 'expired' WHERE status = 'queued' AND expires_at < NOW() RETURNING id");
            if (res.rowCount > 0) {
                console.log(`⏳ Expired ${res.rowCount} stale device commands.`);
            }
        } catch (error) {
            console.error("Expiry Job Error:", error);
        }
    }, 10 * 60 * 1000); // Check every 10 minutes
};

exports.updateDevice = async (req, res) => {
    const { id } = req.params;
    const { model, status, merchant_id } = req.body;
    const { tenant_id, role } = req.user;

    try {
        // Find device
        const checkRes = await pool.query("SELECT * FROM devices WHERE id = $1", [id]);
        if (checkRes.rows.length === 0) return res.status(404).json({ success: false, message: "Device not found" });

        const device = checkRes.rows[0];

        // Authorization
        if (role !== "SUPER_ADMIN" && device.tenant_id !== tenant_id) {
            return res.status(403).json({ success: false, message: "Unauthorized tenant scope" });
        }

        const result = await pool.query(
            `UPDATE devices SET 
                model = COALESCE($1, model), 
                status = COALESCE($2, status), 
                merchant_id = COALESCE($3, merchant_id) 
             WHERE id = $4 RETURNING *`,
            [model, status, merchant_id, id]
        );

        res.json({ success: true, message: "Device updated successfully", device: result.rows[0] });
    } catch (error) {
        console.error("UpdateDevice Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

exports.deleteDevice = async (req, res) => {
    const { id } = req.params;
    const { tenant_id, role } = req.user;

    try {
        // Find device
        const checkRes = await pool.query("SELECT * FROM devices WHERE id = $1", [id]);
        if (checkRes.rows.length === 0) return res.status(404).json({ success: false, message: "Device not found" });

        const device = checkRes.rows[0];

        // Authorization
        if (role !== "SUPER_ADMIN" && device.tenant_id !== tenant_id) {
            return res.status(403).json({ success: false, message: "Unauthorized tenant scope" });
        }

        const result = await pool.query("UPDATE devices SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING *", [id]);

        if (result.rows.length === 0) {
          return res.status(404).json({ success: false, message: "Device not found or already deleted" });
        }

        res.json({ success: true, message: "Device soft-deleted successfully" });
    } catch (error) {
        console.error("DeleteDevice Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};
