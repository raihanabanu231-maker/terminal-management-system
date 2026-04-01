const pool = require("../../config/db");
const crypto = require("crypto");
const QRCode = require("qrcode");
const jwt = require("jsonwebtoken");
const { logAudit } = require("../../utils/audit");

// 1. Generate Enrollment Token (Jayakumar Spec - uses enrollment_tokens table)
exports.generateEnrollmentToken = async (req, res) => {
    const { device_profile_id, max_enrollments, expires_in_minutes, serial, model, tenant_id } = req.body;
    let { merchant_id } = req.body;

    const identityToLock = serial;
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
                return res.status(404).json({ success: false, message: "Store not found" });
            }
            if (req.user.role !== "SUPER_ADMIN" && merchRes.rows[0].tenant_id !== finalTenantId) {
                return res.status(403).json({ success: false, message: "Unauthorized store context" });
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
            // Fetch Tenant Name for display record
            const tRes = await pool.query("SELECT name FROM tenants WHERE id = $1", [finalTenantId]);
            const tenantName = tRes.rows[0]?.name || "Unknown";

            let merchantName = null;
            if (merchant_id) {
                const mRes = await pool.query("SELECT name FROM merchants WHERE id = $1", [merchant_id]);
                merchantName = mRes.rows[0]?.name || "Unknown";
            }

            await pool.query(
                `INSERT INTO devices (serial, model, tenant_id, tenant_name, merchant_id, merchant_name, status, enrollment_token)
                 VALUES ($1, $2, $3, $4, $5, $6, 'pending_onboard', $7)
                 ON CONFLICT (serial) DO UPDATE SET 
                    model = COALESCE(NULLIF($2, 'Standard'), devices.model),
                    enrollment_token = $7, 
                    tenant_name = $4,
                    merchant_name = $6,
                    status = 'pending_onboard'`,
                [serial, model || 'Standard', finalTenantId, tenantName, merchant_id || null, merchantName, tokenHash]
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
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// 2. Enroll Device (Jayakumar Spec)
exports.enrollDevice = async (req, res) => {
    const { token, serial, enrollment_token, serial_number, device_model, os_version, model } = req.body;

    const actualToken = token || enrollment_token;
    const actualSerial = serial || serial_number;
    const actualModel = device_model || model || 'Standard';

    if (!actualToken) return res.status(400).json({ success: false, message: "enrollment_token is required" });

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
                return res.status(403).json({ success: false, message: "Serial mismatch" });
            }

            // Fetch Names for saving in the table
            const tRes = await pool.query("SELECT name FROM tenants WHERE id = $1", [enrollmentRecord.tenant_id]);
            const tenantName = tRes.rows[0]?.name || "Unknown";

            let merchantName = null;
            if (enrollmentRecord.merchant_id) {
                const mRes = await pool.query("SELECT name FROM merchants WHERE id = $1", [enrollmentRecord.merchant_id]);
                merchantName = mRes.rows[0]?.name || "Unknown";
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
                    `INSERT INTO devices (serial, model, tenant_id, tenant_name, merchant_id, merchant_name, merchant_path, status, device_status, os_version)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 'online', $8)
                     ON CONFLICT (serial) DO UPDATE SET 
                        status = 'active', device_status = 'online', model = EXCLUDED.model,
                        os_version = COALESCE(EXCLUDED.os_version, devices.os_version),
                        tenant_name = $4,
                        merchant_name = $6,
                        merchant_path = EXCLUDED.merchant_path, last_seen = NOW(), deleted_at = NULL
                     RETURNING *`,
                    [actualSerial, actualModel, enrollmentRecord.tenant_id, tenantName, enrollmentRecord.merchant_id, merchantName, normalizedPath, os_version || 'Unknown']
                );
                device = deviceRes.rows[0];
                await pool.query("DELETE FROM device_telemetry WHERE device_id = $1", [device.id]);
            }
        } else {
            const result = await pool.query("SELECT * FROM devices WHERE enrollment_token = $1 AND status = 'pending_onboard'", [tokenHash]);
            if (result.rows.length === 0) return res.status(400).json({ success: false, message: "Invalid enrollment" });
            device = result.rows[0];
        }

        if (!device) return res.status(400).json({ success: false, message: "No device context" });

        const access_token = jwt.sign({ id: device.id, role: "DEVICE", tenant_id: device.tenant_id, type: "access" }, process.env.JWT_SECRET, { expiresIn: '1d' });
        const refresh_token = jwt.sign({ id: device.id, role: "DEVICE", tenant_id: device.tenant_id, type: "refresh" }, process.env.JWT_SECRET, { expiresIn: '30d' });

        const accessTokenHash = crypto.createHash('sha256').update(access_token).digest('hex');
        const refreshTokenHash = crypto.createHash('sha256').update(refresh_token).digest('hex');

        await pool.query(
            `UPDATE devices SET status = 'active', enrollment_token = NULL, device_token_hash = $1, device_refresh_token_hash = $2, token_issued_at = NOW(), last_seen = NOW() WHERE id = $3`,
            [accessTokenHash, refreshTokenHash, device.id]
        );

        await logAudit(device.tenant_id, null, "DEVICE_ENROLLED", "DEVICE", device.id, { serial: actualSerial });

        res.json({ success: true, message: "Enrolled", device_id: device.id, access_token, refresh_token, heartbeat_interval: 30 });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// Start jobs
exports.startStatusJob = () => {
    setInterval(async () => {
        try {
            await pool.query("UPDATE devices SET device_status = 'offline' WHERE last_seen < NOW() - INTERVAL '5 minutes' AND device_status != 'offline'");
        } catch (error) { }
    }, 60000);
};

// ---------------------------------------------------------
// RESTORING ALL MISSING EXPORTS FOR ROUTE STABILITY
// ---------------------------------------------------------

exports.refreshDeviceToken = async (req, res) => {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ success: false, message: "token required" });
    try {
        const decoded = jwt.verify(refresh_token, process.env.JWT_SECRET);
        const hash = crypto.createHash('sha256').update(refresh_token).digest('hex');
        const d = await pool.query("SELECT * FROM devices WHERE id = $1 AND device_refresh_token_hash = $2", [decoded.id, hash]);
        if (d.rows.length === 0) return res.status(401).json({ success: false });
        const access = jwt.sign({ id: d.rows[0].id, role: "DEVICE", tenant_id: d.rows[0].tenant_id, type: "access" }, process.env.JWT_SECRET, { expiresIn: '1d' });
        const refresh = jwt.sign({ id: d.rows[0].id, role: "DEVICE", tenant_id: d.rows[0].tenant_id, type: "refresh" }, process.env.JWT_SECRET, { expiresIn: '30d' });
        await pool.query("UPDATE devices SET device_token_hash = $1, device_refresh_token_hash = $2 WHERE id = $3", [crypto.createHash('sha256').update(access).digest('hex'), crypto.createHash('sha256').update(refresh).digest('hex'), d.rows[0].id]);
        res.json({ success: true, access_token: access, refresh_token: refresh });
    } catch (err) { res.status(401).json({ success: false }); }
};

exports.sendDeviceCommand = async (req, res) => {
    const { deviceId } = req.params;
    const { type, payload } = req.body;
    const { role: userRole, tenant_id: userTenantId, roles = [] } = req.user;

    try {
        // 🛡️ SCOPE CHECK: Ensure user has authority over this device
        let scopeQuery = "SELECT id, tenant_id, merchant_path FROM devices WHERE id = $1 AND deleted_at IS NULL";
        const scopeParams = [deviceId];

        if (userRole !== "SUPER_ADMIN") {
            scopeParams.push(userTenantId);
            scopeQuery += ` AND tenant_id = $${scopeParams.length}`;
        }

        const dRes = await pool.query(scopeQuery, scopeParams);
        if (dRes.rows.length === 0) return res.status(404).json({ success: false, message: "Device not found or unauthorized" });

        const device = dRes.rows[0];

        // 🛡️ SUB-LOGIC: Check Merchant Path if Operator
        if (userRole === "OPERATOR") {
            const merchScope = roles.find(r => r.scope === "merchant");
            if (merchScope) {
                const userPath = (merchScope.scope_path || "/").toLowerCase().trim().replace(/\/$/, '') + '/';
                const devicePath = (device.merchant_path || "/").toLowerCase().trim().replace(/\/$/, '') + '/';
                if (!devicePath.startsWith(userPath)) {
                    return res.status(403).json({ success: false, message: "Forbidden: Device is outside your assigned branch scope." });
                }
            }
        }

        const cmdRes = await pool.query(
            "INSERT INTO commands (device_id, type, payload, status, created_by, expires_at) VALUES ($1,$2,$3,'queued',$4, NOW() + INTERVAL '24 hours') RETURNING id",
            [deviceId, type, payload || {}, req.user.id]
        );

        await logAudit(device.tenant_id, req.user.id, `${type}_INITIATED`, 'DEVICE', deviceId, { action: type, payload });

        const { sendCommand } = require("../../gateway/socket.gateway");
        const success = sendCommand(deviceId, { type: "command", id: cmdRes.rows[0].id, cmd: type, payload });
        if (success) await pool.query("UPDATE commands SET status = 'sent', sent_at = NOW() WHERE id = $1", [cmdRes.rows[0].id]);

        res.json({ success: true, command_id: cmdRes.rows[0].id });
    } catch (err) {
        console.error("sendDeviceCommand Error:", err);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

exports.getPendingCommands = async (req, res) => {
    try {
        // Updated: Automatically refresh last_seen during polling to ensure better reliability
        await pool.query("UPDATE devices SET last_seen = NOW() WHERE id = $1", [req.user.id]);

        const r = await pool.query("SELECT id, type, payload FROM commands WHERE device_id = $1 AND status = 'queued'", [req.user.id]);
        res.json({ success: true, commands: r.rows });
    } catch (err) { res.status(500).json({ success: false }); }
};

exports.ackCommand = async (req, res) => {
    const { commandId } = req.params;
    const { success, result_data } = req.body;
    const deviceId = req.user.id;
    try {
        const status = success ? 'completed' : 'failed';
        await pool.query("UPDATE commands SET status = $1, acked_at = NOW(), payload = payload || $2::jsonb WHERE id = $3", [status, JSON.stringify({ result_data }), commandId]);

        const cmdRes = await pool.query("SELECT c.type, c.payload, d.tenant_id FROM commands c JOIN devices d ON c.device_id = d.id WHERE c.id = $1", [commandId]);
        if (cmdRes.rows.length > 0) {
            const { type, payload, tenant_id } = cmdRes.rows[0];
            await logAudit(tenant_id, null, `${type}_${status.toUpperCase()}`, 'DEVICE', deviceId, { result: result_data });

            // 🎯 SYNC: Update the device policy when the toggle command succeeds
            if (type === 'TOGGLE_LOGGING' && success) {
                const isEnabled = payload?.action === 'ON';
                await pool.query("UPDATE devices SET audit_logging_enabled = $1 WHERE id = $2", [isEnabled, deviceId]);
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error("ackCommand Error:", err);
        res.status(500).json({ success: false });
    }
};

exports.getDevices = async (req, res) => {
    try {
        const { role: userRole, tenant_id: userTenantId, roles = [] } = req.user;
        const { status, merchant_id } = req.query;

        let userScopePath = "/";
        if (userRole !== "SUPER_ADMIN") {
            const merchantRoles = roles.filter(r => r.scope === "merchant");
            if (merchantRoles.length > 0) userScopePath = merchantRoles[0].scope_path || "/";
        }

        let query = "SELECT * FROM devices WHERE deleted_at IS NULL";
        const params = [];

        if (userRole !== "SUPER_ADMIN") {
            params.push(userTenantId);
            query += ` AND tenant_id = $${params.length}`;
        }

        if (userScopePath && userScopePath !== "/") {
            params.push(userScopePath);
            query += ` AND (COALESCE(merchant_path, '/') || '/') ILIKE $${params.length} || '%'`;
        }

        if (status) {
            params.push(status);
            query += ` AND status = $${params.length}`;
        }

        if (merchant_id) {
            params.push(merchant_id);
            query += ` AND merchant_id = $${params.length}`;
        }

        query += " ORDER BY created_at DESC";

        const r = await pool.query(query, params);
        res.json({ success: true, data: r.rows });
    } catch (err) {
        console.error("getDevices Error:", err);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

exports.getDeviceById = async (req, res) => {
    try {
        const { role: userRole, tenant_id: userTenantId, roles = [] } = req.user;
        const { id } = req.params;

        let query = "SELECT * FROM devices WHERE id = $1 AND deleted_at IS NULL";
        const params = [id];

        if (userRole !== "SUPER_ADMIN") {
            params.push(userTenantId);
            query += ` AND tenant_id = $${params.length}`;
        }

        const r = await pool.query(query, params);
        if (r.rows.length === 0) return res.status(404).json({ success: false, message: "Device not found" });

        const device = r.rows[0];

        // 🛡️ Additional Merchant Path check for Operators
        if (userRole === "OPERATOR") {
            const merchScope = roles.find(r => r.scope === "merchant");
            if (merchScope) {
                const userPath = (merchScope.scope_path || "/").toLowerCase().trim().replace(/\/$/, '') + '/';
                const devicePath = (device.merchant_path || "/").toLowerCase().trim().replace(/\/$/, '') + '/';
                if (!devicePath.startsWith(userPath)) {
                    return res.status(403).json({ success: false, message: "Forbidden: Access outside assigned scope" });
                }
            }
        }

        res.json({ success: true, data: device });
    } catch (err) {
        console.error("getDeviceById Error:", err);
        res.status(500).json({ success: false });
    }
};

exports.getCommandStatus = async (req, res) => {
    try {
        const { role: userRole, tenant_id: userTenantId } = req.user;
        const { commandId } = req.params;

        let query = `
            SELECT c.* 
            FROM commands c
            JOIN devices d ON c.device_id = d.id
            WHERE c.id = $1
        `;
        const params = [commandId];

        if (userRole !== "SUPER_ADMIN") {
            params.push(userTenantId);
            query += ` AND d.tenant_id = $${params.length}`;
        }

        const r = await pool.query(query, params);
        if (r.rows.length === 0) return res.status(404).json({ success: false, message: "Command not found or unauthorized" });

        res.json({ success: true, command: r.rows[0] });
    } catch (err) {
        console.error("getCommandStatus Error:", err);
        res.status(500).json({ success: false });
    }
};

exports.updateDevice = async (req, res) => {
    try {
        const { role: userRole, tenant_id: userTenantId } = req.user;
        const { id } = req.params;
        const { model, merchant_id } = req.body;

        // 🛡️ Scope check
        const checkQuery = userRole === "SUPER_ADMIN" ?
            "SELECT id FROM devices WHERE id = $1" :
            "SELECT id FROM devices WHERE id = $1 AND tenant_id = $2";
        const checkParams = userRole === "SUPER_ADMIN" ? [id] : [id, userTenantId];

        const deviceCheck = await pool.query(checkQuery, checkParams);
        if (deviceCheck.rows.length === 0) return res.status(404).json({ success: false, message: "Device not found or unauthorized" });

        // Fetch Names if moved to new merchant
        let merchantName = null;
        let merchantPath = "/";
        if (merchant_id) {
            const mRes = await pool.query("SELECT name, name_path FROM merchants WHERE id = $1", [merchant_id]);
            if (mRes.rows.length > 0) {
                merchantName = mRes.rows[0].name;
                merchantPath = (mRes.rows[0].name_path || "/").toLowerCase().trim().replace(/\/$/, '') + '/';
            }
        }

        await pool.query(
            "UPDATE devices SET model = $1, merchant_id = $2, merchant_name = $3, merchant_path = $4 WHERE id = $5",
            [model, merchant_id, merchantName, merchantPath, id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("updateDevice Error:", err);
        res.status(500).json({ success: false });
    }
};

exports.deleteDevice = async (req, res) => {
    try {
        const { role: userRole, tenant_id: userTenantId } = req.user;
        const { id } = req.params;

        // 🛡️ Scope check
        const checkQuery = userRole === "SUPER_ADMIN" ?
            "SELECT id FROM devices WHERE id = $1" :
            "SELECT id FROM devices WHERE id = $1 AND tenant_id = $2";
        const checkParams = userRole === "SUPER_ADMIN" ? [id] : [id, userTenantId];

        const deviceCheck = await pool.query(checkQuery, checkParams);
        if (deviceCheck.rows.length === 0) return res.status(404).json({ success: false, message: "Device not found or unauthorized" });

        await pool.query("UPDATE devices SET deleted_at = NOW(), status = 'deleted' WHERE id = $1", [id]);
        res.json({ success: true });
    } catch (err) {
        console.error("deleteDevice Error:", err);
        res.status(500).json({ success: false });
    }
};

exports.receiveHeartbeat = async (req, res) => {
    try {
        await pool.query("UPDATE devices SET last_seen = NOW(), status = 'active' WHERE id = $1", [req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
};

exports.checkEnrollmentStatus = async (req, res) => {
    try {
        const { role: userRole, tenant_id: userTenantId } = req.user;
        const { id } = req.params;

        let query = "SELECT * FROM enrollment_tokens WHERE id = $1";
        const params = [id];

        if (userRole !== "SUPER_ADMIN") {
            params.push(userTenantId);
            query += ` AND tenant_id = $${params.length}`;
        }

        const r = await pool.query(query, params);
        if (r.rows.length === 0) return res.status(404).json({ success: false, message: "Token not found or unauthorized" });

        res.json({ success: true, data: r.rows[0] });
    } catch (err) {
        console.error("checkEnrollmentStatus Error:", err);
        res.status(500).json({ success: false });
    }
};
