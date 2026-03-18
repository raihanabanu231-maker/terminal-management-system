const pool = require("../../config/db");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { logAudit } = require("../../utils/audit");

// 1. Generate Enrollment Token (Jayakumar Spec - uses enrollment_tokens table)
exports.generateEnrollmentToken = async (req, res) => {
    const { merchant_id, device_profile_id, max_enrollments, expires_in_minutes, serial, model, tenant_id } = req.body;

    const finalTenantId = (req.user.role === "SUPER_ADMIN" && tenant_id)
        ? tenant_id
        : req.user.tenant_id;

    if (!finalTenantId) {
        return res.status(400).json({ success: false, message: "tenant_id is required" });
    }

    try {
        // Validate merchant exists if provided
        if (merchant_id) {
            const merchRes = await pool.query("SELECT id FROM merchants WHERE id = $1 AND tenant_id = $2", [merchant_id, finalTenantId]);
            if (merchRes.rows.length === 0) {
                return res.status(404).json({ success: false, message: "Merchant not found or does not belong to this tenant" });
            }
        }

        const token = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const maxEnroll = max_enrollments || 1;
        const expiryMins = expires_in_minutes || 10;
        const expiresAt = new Date(Date.now() + expiryMins * 60 * 1000);

        // Store in enrollment_tokens table (Jayakumar Spec)
        const tokenRes = await pool.query(
            `INSERT INTO enrollment_tokens (tenant_id, merchant_id, device_profile_id, token_hash, max_enrollments, remaining_enrollments, expires_at, created_by)
             VALUES ($1, $2, $3, $4, $5, $5, $6, $7)
             RETURNING id`,
            [finalTenantId, merchant_id || null, device_profile_id || null, tokenHash, maxEnroll, expiresAt, req.user.id]
        );
        const tokenId = tokenRes.rows[0].id;

        // Also create device record if serial is provided (backward compatible)
        if (serial) {
            await pool.query(
                `INSERT INTO devices (serial, model, enrollment_token, merchant_id, tenant_id, status)
                 VALUES ($1, $2, $3, $4, $5, 'pending_onboard')
                 ON CONFLICT (serial) 
                 DO UPDATE SET enrollment_token = $3, status = 'pending_onboard'`,
                [serial, model || 'Standard', tokenHash, merchant_id || null, finalTenantId]
            );
        }

        const qrData = JSON.stringify({ token: token, tenant_id: finalTenantId, serial: serial || null });
        const qrCodeImage = await QRCode.toDataURL(qrData);

        // Fetch names for UI feedback
        const tenantRes = await pool.query("SELECT name FROM tenants WHERE id = $1", [finalTenantId]);
        const tenantName = tenantRes.rows[0]?.name || "Unknown";
        
        let merchantName = null;
        if (merchant_id) {
            const merchRes = await pool.query("SELECT name FROM merchants WHERE id = $1", [merchant_id]);
            merchantName = merchRes.rows[0]?.name || "Unknown";
        }

        res.json({
            success: true,
            token_id: tokenId,
            token: token,
            qr_code: qrCodeImage,
            expires_at: expiresAt,
            max_enrollments: maxEnroll,
            tenant_name: tenantName,
            merchant_name: merchantName
        });
    } catch (error) {
        console.error("GENERATE ENROLLMENT TOKEN ERROR:", error);
        res.status(500).json({ success: false, message: "Server error", detail: error.message });
    }
};

// 2. Enroll Device (Jayakumar Spec - uses enrollment_tokens + device_tokens tables)
exports.enrollDevice = async (req, res) => {
    const { token, serial, enrollment_token, serial_number, device_model, os_version, agent_version, fingerprint } = req.body;

    // Support both old field names and Sir's spec field names
    const actualToken = token || enrollment_token;
    const actualSerial = serial || serial_number;

    if (!actualToken) {
        return res.status(400).json({ success: false, message: "enrollment_token is required" });
    }

    try {
        const tokenHash = crypto.createHash('sha256').update(actualToken).digest('hex');

        // Step 1: Validate enrollment token from enrollment_tokens table
        const enrollTokenRes = await pool.query(
            `SELECT * FROM enrollment_tokens 
             WHERE token_hash = $1 
             AND expires_at > NOW() 
             AND remaining_enrollments > 0`,
            [tokenHash]
        );

        let enrollmentRecord = null;
        let device = null;

        if (enrollTokenRes.rows.length > 0) {
            // New flow: enrollment_tokens table
            enrollmentRecord = enrollTokenRes.rows[0];

            // Decrement remaining enrollments
            await pool.query(
                "UPDATE enrollment_tokens SET remaining_enrollments = remaining_enrollments - 1 WHERE id = $1",
                [enrollmentRecord.id]
            );

            // Create or update device record
            if (actualSerial) {
                const deviceRes = await pool.query(
                    `INSERT INTO devices (serial, model, tenant_id, merchant_id, status, device_status)
                     VALUES ($1, $2, $3, $4, 'active', 'online')
                     ON CONFLICT (serial) 
                     DO UPDATE SET status = 'active', device_status = 'online', last_seen = NOW()
                     RETURNING *`,
                    [actualSerial, device_model || 'Standard', enrollmentRecord.tenant_id, enrollmentRecord.merchant_id]
                );
                device = deviceRes.rows[0];
            }
        } else {
            // Fallback: old flow using devices table directly
            const result = await pool.query(
                "SELECT * FROM devices WHERE enrollment_token = $1 AND status = 'pending_onboard'",
                [tokenHash]
            );

            if (result.rows.length === 0) {
                return res.status(400).json({ success: false, message: "Invalid or expired enrollment token" });
            }
            device = result.rows[0];
        }

        if (!device) {
            return res.status(400).json({ success: false, message: "Could not create device. Serial number required." });
        }

        // Step 2: Generate Device JWT
        const jwt = require("jsonwebtoken");
        const deviceToken = jwt.sign(
            { id: device.id, role: "DEVICE", tenant_id: device.tenant_id },
            process.env.JWT_SECRET
        );

        const deviceTokenHash = crypto.createHash('sha256').update(deviceToken).digest('hex');

        // Step 3: Update device record
        await pool.query(
            `UPDATE devices 
             SET status = 'active', 
                 device_status = 'online',
                 enrollment_token = NULL, 
                 enrollment_token_used = $1, 
                 device_token_hash = $2, 
                 last_seen = NOW() 
             WHERE id = $3`,
            [tokenHash, deviceTokenHash, device.id]
        );

        // Step 4: Store in device_tokens table (Jayakumar Spec)
        await pool.query(
            `INSERT INTO device_tokens (device_id, token_hash, issued_at)
             VALUES ($1, $2, NOW())`,
            [device.id, deviceTokenHash]
        );

        // Step 5: Audit logs
        await logAudit(device.tenant_id, null, "DEVICE_ENROLLED", "DEVICE", device.id, { serial: actualSerial });
        await logAudit(device.tenant_id, null, "DEVICE_TOKEN_CREATED", "DEVICE", device.id, { serial: actualSerial });

        // Step 6: Return response (Jayakumar Spec format)
        res.json({
            success: true,
            message: "Device Enrolled Successfully",
            device_id: device.id,
            device_token: deviceToken,
            heartbeat_interval: 30
        });

    } catch (error) {
        console.error("ENROLL DEVICE ERROR:", error);
        res.status(500).json({ success: false, message: "Server error", detail: error.message });
    }
};

// 3. Remote Command
exports.sendDeviceCommand = async (req, res) => {
    const { deviceId } = req.params;
    const { type, payload } = req.body;

    const ALLOWED_COMMANDS = [
        "REBOOT", "SHUTDOWN", 
        "LOCK_DEVICE", "UNLOCK_DEVICE", 
        "PASSWORD_UPDATE",
        "TOGGLE_DEVELOPER_OPTIONS", "TOGGLE_DEVICE_LOGS",
        "TOGGLE_WIFI", "TOGGLE_BLUETOOTH",
        "SYNC", "WIPE", "INSTALL_ARTIFACT"
    ];

    if (!type || !ALLOWED_COMMANDS.includes(type)) {
        return res.status(400).json({ 
            success: false, 
            message: `Invalid or missing command type. Allowed types: ${ALLOWED_COMMANDS.join(", ")}` 
        });
    }

    try {
        let sql = "SELECT id, tenant_id FROM devices WHERE id = $1";
        const params = [deviceId];

        if (req.user.role !== "SUPER_ADMIN") {
            sql += " AND tenant_id = $2";
            params.push(req.user.tenant_id);
        }

        const deviceRes = await pool.query(sql, params);

        if (deviceRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Device not found or not in your tenant scope" });
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
            res.json({ success: true, command_id: commandId, status: "sent" });
        } else {
            res.json({ success: true, message: "Queued (Device Offline)", command_id: commandId, status: "queued" });
        }

    } catch (error) {
        console.error("SEND_COMMAND_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error", detail: error.message });
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
    const { success, error_message, result_data, execution_time_ms } = req.body;
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
                 SET status = 'completed', acked_at = NOW(), 
                     execution_time_ms = $1,
                     payload = payload || $2::jsonb 
                 WHERE id = $3`,
                [execution_time_ms || null, JSON.stringify({ result_data }), commandId]
            );
            await logAudit(null, null, "COMMAND_ACKED", "DEVICE", deviceId, { command_id: commandId, execution_time_ms });
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
                await logAudit(null, null, "COMMAND_FAILED", "DEVICE", deviceId, { command_id: commandId, error_message });
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

// 6. Status Normalization Job (Jayakumar Spec)
// 3-state model: ONLINE (<90s), DEGRADED (<5 min), OFFLINE (>5 min)
exports.startStatusJob = () => {
    setInterval(async () => {
        try {
            // Mark OFFLINE: no heartbeat for > 5 minutes
            const offlineRes = await pool.query(
                `UPDATE devices SET device_status = 'offline' 
                 WHERE last_seen < NOW() - INTERVAL '5 minutes' 
                 AND device_status != 'offline' 
                 AND status = 'active'
                 RETURNING id`
            );
            // Audit log for devices going offline
            if (offlineRes.rowCount > 0) {
                for (const row of offlineRes.rows) {
                    await logAudit(null, null, "DEVICE_OFFLINE", "DEVICE", row.id, { reason: "heartbeat_timeout" });
                }
            }

            // Mark DEGRADED: no heartbeat for > 90 seconds but < 5 minutes
            await pool.query(
                `UPDATE devices SET device_status = 'degraded' 
                 WHERE last_seen < NOW() - INTERVAL '90 seconds' 
                 AND last_seen >= NOW() - INTERVAL '5 minutes'
                 AND device_status != 'degraded'
                 AND status = 'active'`
            );

            // Mark ONLINE: heartbeat within 90 seconds
            const onlineRes = await pool.query(
                `UPDATE devices SET device_status = 'online' 
                 WHERE last_seen >= NOW() - INTERVAL '90 seconds' 
                 AND device_status != 'online'
                 AND status = 'active'
                 RETURNING id`
            );
            // Audit log for devices coming online
            if (onlineRes.rowCount > 0) {
                for (const row of onlineRes.rows) {
                    await logAudit(null, null, "DEVICE_ONLINE", "DEVICE", row.id, { reason: "heartbeat_received" });
                }
            }
        } catch (error) {
            console.error("Status Job Error:", error);
        }
    }, 60000); // Check every minute
};

// 6b. Data Retention Cleanup Job (Week 3 logic)
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

// 7. Command Expiry Job (Jayakumar Spec: every 30 seconds)
exports.startExpiryJob = () => {
    setInterval(async () => {
        try {
            const res = await pool.query(
                `UPDATE commands SET status = 'expired' 
                 WHERE status IN ('queued', 'sent') 
                 AND expires_at < NOW() 
                 RETURNING id`
            );
            if (res.rowCount > 0) {
                console.log(`⏳ Expired ${res.rowCount} stale device commands.`);
            }
        } catch (error) {
            console.error("Expiry Job Error:", error);
        }
    }, 30 * 1000); // Every 30 seconds per spec
};

// 8. Command Retry Job (Jayakumar Spec: every 1 minute)
// Auto-retries commands that were SENT but never ACKed within 60 seconds
exports.startRetryJob = () => {
    setInterval(async () => {
        try {
            const res = await pool.query(
                `UPDATE commands 
                 SET status = 'queued', retry_count = retry_count + 1 
                 WHERE status = 'sent' 
                 AND sent_at < NOW() - INTERVAL '60 seconds'
                 AND retry_count < max_retries
                 RETURNING id, device_id, retry_count`
            );
            if (res.rowCount > 0) {
                console.log(`🔄 Retried ${res.rowCount} unacknowledged commands.`);
                for (const row of res.rows) {
                    await logAudit(null, null, "COMMAND_RETRY", "DEVICE", row.device_id, { 
                        command_id: row.id, 
                        attempt: row.retry_count 
                    });
                }
            }

            // Mark commands that exceeded max retries as FAILED
            const failedRes = await pool.query(
                `UPDATE commands 
                 SET status = 'failed', acked_at = NOW()
                 WHERE status = 'sent'
                 AND sent_at < NOW() - INTERVAL '60 seconds'
                 AND retry_count >= max_retries
                 RETURNING id, device_id`
            );
            if (failedRes.rowCount > 0) {
                console.log(`❌ Failed ${failedRes.rowCount} commands (max retries exceeded).`);
                for (const row of failedRes.rows) {
                    await logAudit(null, null, "COMMAND_FAILED", "DEVICE", row.device_id, { 
                        command_id: row.id, 
                        reason: "max_retries_exceeded" 
                    });
                }
            }
        } catch (error) {
            console.error("Retry Job Error:", error);
        }
    }, 60 * 1000); // Every 1 minute per spec
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

// 10. Check Enrollment Status (Polling for UI to dismiss QR code)
exports.checkEnrollmentStatus = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            "SELECT remaining_enrollments, max_enrollments FROM enrollment_tokens WHERE id = $1", 
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Enrollment token not found" });
        }
        
        const tokenData = result.rows[0];
        // If remaining is less than max, it means at least one device enrolled
        const isEnrolled = tokenData.remaining_enrollments < tokenData.max_enrollments;
        
        res.json({
            success: true,
            enrolled: isEnrolled,
            remaining_enrollments: tokenData.remaining_enrollments
        });
    } catch (error) {
        console.error("CHECK ENROLLMENT STATUS ERROR:", error);
        res.status(500).json({ success: false, message: "Server error", detail: error.message });
    }
};
