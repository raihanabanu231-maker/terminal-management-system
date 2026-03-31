const pool = require("../../config/db");
const crypto = require("crypto");
const QRCode = require("qrcode");
const jwt = require("jsonwebtoken");
const { logAudit } = require("../../utils/audit");

// 1. Generate Enrollment Token (Jayakumar Spec - uses enrollment_tokens table)
exports.generateEnrollmentToken = async (req, res) => {
    const { device_profile_id, max_enrollments, expires_in_minutes, serial, android_id, model, tenant_id } = req.body;
    let { merchant_id } = req.body;

    const identityToLock = serial || android_id;
    let finalTenantId = (req.user.role === "SUPER_ADMIN" && tenant_id) ? tenant_id : req.user.tenant_id;

    if (merchant_id === "null" || merchant_id === "undefined" || merchant_id === "" || merchant_id === finalTenantId) {
        merchant_id = null;
    }

    if (!finalTenantId) {
        return res.status(400).json({ success: false, message: "tenant_id is required" });
    }

    try {
        if (merchant_id) {
            const merchRes = await pool.query("SELECT id, tenant_id FROM merchants WHERE id = $1", [merchant_id]);
            if (merchRes.rows.length === 0) {
                return res.status(404).json({ success: false, message: "Invalid Target Store: Merchant not found" });
            }
            if (req.user.role !== "SUPER_ADMIN" && merchRes.rows[0].tenant_id !== finalTenantId) {
                return res.status(403).json({ success: false, message: "Unauthorized merchant access" });
            }
            if (req.user.role === "SUPER_ADMIN") finalTenantId = merchRes.rows[0].tenant_id;
        }

        const token = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const maxEnroll = max_enrollments || 1;
        const expiryMins = expires_in_minutes || 10;
        const expiresAt = new Date(Date.now() + expiryMins * 60 * 1000);

        const tokenRes = await pool.query(
            `INSERT INTO enrollment_tokens (tenant_id, merchant_id, device_profile_id, token_hash, serial, max_enrollments, remaining_enrollments, expires_at, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8)
             RETURNING id`,
            [finalTenantId, merchant_id || null, device_profile_id || null, tokenHash, identityToLock || null, maxEnroll, expiresAt, req.user.id]
        );

        if (serial) {
            await pool.query(
                `INSERT INTO devices (serial, model, tenant_id, merchant_id, status, enrollment_token)
                 VALUES ($1, $2, $3, $4, 'pending_onboard', $5)
                 ON CONFLICT (serial) DO UPDATE SET model = COALESCE(NULLIF($2, 'Standard'), devices.model), enrollment_token = $5, status = 'pending_onboard'`,
                [serial, model || 'Standard', finalTenantId, merchant_id || null, tokenHash]
            );
        }

        const qrData = JSON.stringify({ token: token, tenant_id: finalTenantId, serial: serial || null });
        const qrCodeImage = await QRCode.toDataURL(qrData);

        res.json({
            success: true,
            token: token,
            qr_code: qrCodeImage,
            expires_at: expiresAt,
            max_enrollments: maxEnroll
        });
    } catch (error) {
        console.error("GENERATE ENROLLMENT TOKEN ERROR:", error);
        res.status(500).json({ success: false, message: "Server error", detail: error.message });
    }
};

// 2. Enroll Device (Jayakumar Spec)
exports.enrollDevice = async (req, res) => {
    const { token, serial, android_id, enrollment_token, serial_number, device_model, os_version, model } = req.body;

    const actualToken = token || enrollment_token;
    const actualSerial = serial || serial_number || android_id;
    const actualModel = device_model || model || 'Standard';

    if (!actualToken) {
        return res.status(400).json({ success: false, message: "enrollment_token is required" });
    }

    try {
        const tokenHash = crypto.createHash('sha256').update(actualToken).digest('hex');

        const enrollTokenRes = await pool.query(
            "SELECT * FROM enrollment_tokens WHERE token_hash = $1 AND expires_at > NOW() AND remaining_enrollments > 0",
            [tokenHash]
        );

        let device = null;

        if (enrollTokenRes.rows.length > 0) {
            const enrollmentRecord = enrollTokenRes.rows[0];
            const storedSerial = String(enrollmentRecord.serial || "").trim().toLowerCase();
            const incomingSerial = String(actualSerial || "").trim().toLowerCase();

            if (enrollmentRecord.serial && storedSerial !== incomingSerial) {
                return res.status(403).json({ success: false, message: "Security Violation: Serial mismatch" });
            }

            await pool.query("UPDATE enrollment_tokens SET remaining_enrollments = remaining_enrollments - 1 WHERE id = $1", [enrollmentRecord.id]);

            let normalizedPath = "/";
            if (enrollmentRecord.merchant_id) {
                const merchInfo = await pool.query("SELECT name_path FROM merchants WHERE id = $1", [enrollmentRecord.merchant_id]);
                if (merchInfo.rows[0]?.name_path) {
                    normalizedPath = merchInfo.rows[0].name_path.toLowerCase().trim().replace(/\/$/, '') + '/';
                }
            }

            if (actualSerial) {
                const deviceRes = await pool.query(
                    `INSERT INTO devices (serial, model, tenant_id, merchant_id, merchant_path, status, device_status, os_version)
                     VALUES ($1, $2, $3, $4, $5, 'active', 'online', $6)
                     ON CONFLICT (serial) DO UPDATE SET 
                        status = 'active', device_status = 'online', model = EXCLUDED.model,
                        os_version = COALESCE(EXCLUDED.os_version, devices.os_version),
                        merchant_path = EXCLUDED.merchant_path, last_seen = NOW(), deleted_at = NULL
                     RETURNING *`,
                    [actualSerial, actualModel, enrollmentRecord.tenant_id, enrollmentRecord.merchant_id, normalizedPath, os_version || 'Unknown']
                );
                device = deviceRes.rows[0];
            }
        } else {
            const result = await pool.query("SELECT * FROM devices WHERE enrollment_token = $1 AND status = 'pending_onboard'", [tokenHash]);
            if (result.rows.length === 0) return res.status(400).json({ success: false, message: "Invalid token" });
            device = result.rows[0];
        }

        if (!device) return res.status(400).json({ success: false, message: "Enrollment failed" });

        const access_token = jwt.sign({ id: device.id, role: "DEVICE", tenant_id: device.tenant_id, type: "access" }, process.env.JWT_SECRET, { expiresIn: '1d' });
        const refresh_token = jwt.sign({ id: device.id, role: "DEVICE", tenant_id: device.tenant_id, type: "refresh" }, process.env.JWT_SECRET, { expiresIn: '30d' });

        const accessTokenHash = crypto.createHash('sha256').update(access_token).digest('hex');
        const refreshTokenHash = crypto.createHash('sha256').update(refresh_token).digest('hex');

        await pool.query(
            `UPDATE devices SET status = 'active', device_status = 'online', enrollment_token = NULL, 
             device_token_hash = $1, device_refresh_token_hash = $2, token_issued_at = NOW(), last_seen = NOW() WHERE id = $3`,
            [accessTokenHash, refreshTokenHash, device.id]
        );

        await logAudit(device.tenant_id, null, "DEVICE_ENROLLED", "DEVICE", device.id, { serial: actualSerial });

        res.json({
            success: true,
            message: "Device Enrolled Successfully",
            device_id: device.id,
            access_token: access_token,
            refresh_token: refresh_token,
            heartbeat_interval: 30
        });

    } catch (error) {
        console.error("ENROLL DEVICE ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// 3. Remote Command
exports.sendDeviceCommand = async (req, res) => {
    const { deviceId } = req.params;
    const { type, payload } = req.body;

    const ALLOWED_COMMANDS = ["REBOOT", "SHUTDOWN", "SYNC", "WIPE", "TOGGLE_WIFI", "TOGGLE_BLUETOOTH", "INSTALL_ARTIFACT"];
    if (!type || !ALLOWED_COMMANDS.includes(type)) return res.status(400).json({ success: false, message: "Invalid command" });

    try {
        const deviceRes = await pool.query("SELECT id, tenant_id FROM devices WHERE id = $1", [deviceId]);
        if (deviceRes.rows.length === 0) return res.status(404).json({ success: false, message: "Device not found" });

        const device = deviceRes.rows[0];
        const cmdRes = await pool.query(
            `INSERT INTO commands (device_id, type, payload, status, created_by, expires_at)
             VALUES ($1, $2, $3, 'queued', $4, NOW() + INTERVAL '24 hours') RETURNING id`,
            [deviceId, type, payload || {}, req.user.id]
        );

        const commandId = cmdRes.rows[0].id;
        const state = payload?.state ? String(payload.state).toUpperCase() : "TOGGLE";
        
        await logAudit(device.tenant_id, req.user.id, `DEVICE_${type}_INITIATED`, "DEVICE", deviceId, { 
            type, command_id: commandId, message: `${type} command sent: State ${state}.`
        });

        const { sendCommand } = require("../../gateway/socket.gateway");
        const success = sendCommand(deviceId, { type: "command", id: commandId, cmd: type, payload: payload });

        if (success) {
            await pool.query("UPDATE commands SET status = 'sent', sent_at = NOW() WHERE id = $1", [commandId]);
            res.json({ success: true, command_id: commandId, status: "sent" });
        } else {
            res.json({ success: true, message: "Queued (Device Offline)", command_id: commandId, status: "queued" });
        }

    } catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// 4. Device Command ACK
exports.ackCommand = async (req, res) => {
    const { commandId } = req.params;
    const { success, error_message, result_data, execution_time_ms } = req.body;
    const deviceId = req.user.id;

    try {
        const cmdRes = await pool.query("SELECT * FROM commands WHERE id = $1 AND device_id = $2", [commandId, deviceId]);
        if (cmdRes.rows.length === 0) return res.status(404).json({ success: false, message: "Command not found" });

        const cmd = cmdRes.rows[0];

        if (success) {
            await pool.query(
                `UPDATE commands SET status = 'completed', acked_at = NOW(), execution_time_ms = $1,
                 payload = payload || $2::jsonb WHERE id = $3`,
                [execution_time_ms || null, JSON.stringify({ result_data }), commandId]
            );

            const deviceCheck = await pool.query("SELECT tenant_id FROM devices WHERE id = $1", [deviceId]);
            const tenantId = deviceCheck.rows[0]?.tenant_id;
            
            await logAudit(tenantId || null, null, `COMMAND_${cmd.type}_SUCCESS`, "DEVICE", deviceId, { 
                command_id: commandId, message: `Command ${cmd.type} completed successfully.`
            });
        } else {
            await pool.query("UPDATE commands SET status = 'failed', acked_at = NOW() WHERE id = $1", [commandId]);
            const deviceCheck = await pool.query("SELECT tenant_id FROM devices WHERE id = $1", [deviceId]);
            await logAudit(deviceCheck.rows[0]?.tenant_id || null, null, `COMMAND_${cmd.type}_FAILURE`, "DEVICE", deviceId, { error_message });
        }

        res.json({ success: true, message: "ACK'd" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// 5. Get Devices
exports.getDevices = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT d.*, m.name as merchant_name, t.name as tenant_name FROM devices d 
             JOIN tenants t ON d.tenant_id = t.id 
             LEFT JOIN merchants m ON d.merchant_id = m.id WHERE d.deleted_at IS NULL`
        );
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};

// 6. Receive Heartbeat
exports.receiveHeartbeat = async (req, res) => {
    const deviceId = req.user.id;
    try {
        await pool.query("UPDATE devices SET last_seen = NOW(), status = 'active' WHERE id = $1", [deviceId]);
        res.json({ success: true, message: "Heartbeat acknowledged" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// Start jobs
exports.startStatusJob = () => {
    setInterval(async () => {
        try {
            await pool.query("UPDATE devices SET device_status = 'offline' WHERE last_seen < NOW() - INTERVAL '5 minutes' AND device_status != 'offline'");
        } catch (error) {}
    }, 60000);
};

exports.deleteDevice = async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query("UPDATE devices SET deleted_at = NOW(), status = 'deleted' WHERE id = $1", [id]);
        res.json({ success: true, message: "Soft-deleted" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
};
