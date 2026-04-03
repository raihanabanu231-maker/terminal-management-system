const pool = require("../../config/db");
const { logAudit } = require("../../utils/audit");
const { generateUploadUrl, generateDownloadUrl } = require("../../utils/s3");

// Helper: Normalize Paths for RBAC
const normalizePath = (path) => {
    if (!path) return "/";
    let p = path.trim().toLowerCase();
    if (!p.startsWith("/")) p = "/" + p;
    if (!p.endsWith("/")) p = p + "/";
    return p;
};

/**
 * 1. Retrieve System Audit Logs
 */
exports.getAuditLogs = async (req, res) => {
    try {
        const { resource_type, action, user_id, target_id, limit = 50, offset = 0 } = req.query;
        const { role: userRole, tenant_id: tenantId } = req.user;

        let query = `
            SELECT al.*, u.email as user_email, t.name as tenant_name
            FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id
            LEFT JOIN tenants t ON al.tenant_id = t.id
            WHERE 1=1
        `;
        const params = [];

        if (userRole !== "SUPER_ADMIN") {
            params.push(tenantId);
            query += ` AND al.tenant_id = $${params.length}`;
        }

        if (resource_type) {
            params.push(resource_type);
            query += ` AND al.resource_type = $${params.length}`;
        }
        if (action) {
            params.push(action);
            query += ` AND al.action = $${params.length}`;
        }
        if (user_id) {
            params.push(user_id);
            query += ` AND al.user_id = $${params.length}`;
        }
        if (target_id) {
            params.push(target_id);
            query += ` AND al.resource_id = $${params.length}`;
        }

        const fLimit = parseInt(limit) || 50;
        const fOffset = parseInt(offset) || 0;
        const currentParamsCount = params.length;
        query += ` ORDER BY al.created_at DESC LIMIT $${currentParamsCount + 1} OFFSET $${currentParamsCount + 2}`;
        params.push(fLimit, fOffset);

        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows, meta: { limit: fLimit, offset: fOffset, count: result.rows.length } });

    } catch (error) {
        console.error("GetAuditLogs Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

/**
 * 2. Start Log Session (Tenant Admin / Operator)
 * Enforces single active session per device.
 */
exports.startLogSession = async (req, res) => {
    const { device_id, log_level = 'DEBUG' } = req.body;
    const { role: userRole, tenant_id: userTenantId, id: userId, roles = [] } = req.user;

    if (!device_id) return res.status(400).json({ success: false, message: "device_id is required" });

    try {
        // 🛡️ RBAC & Scope Check
        let deviceQuery = "SELECT id, tenant_id, merchant_path FROM devices WHERE id = $1 AND deleted_at IS NULL";
        const deviceParams = [device_id];

        if (userRole !== "SUPER_ADMIN") {
            deviceParams.push(userTenantId);
            deviceQuery += ` AND tenant_id = $${deviceParams.length}`;
        }

        const dRes = await pool.query(deviceQuery, deviceParams);
        if (dRes.rows.length === 0) return res.status(404).json({ success: false, message: "Device not found or unauthorized" });

        const device = dRes.rows[0];

        // Operator check
        if (userRole === "OPERATOR") {
            const merchScope = roles.find(r => r.scope === "merchant");
            if (merchScope) {
                const userPath = normalizePath(merchScope.scope_path);
                const devicePath = normalizePath(device.merchant_path);
                if (!devicePath.startsWith(userPath)) {
                    return res.status(403).json({ success: false, message: "Device outside your assigned branch scope" });
                }
            }
        }

        // 🛡️ PREVENT MULTIPLE ACTIVE SESSIONS
        const activeCheck = await pool.query("SELECT id FROM device_log_sessions WHERE device_id = $1 AND status = 'active'", [device_id]);
        if (activeCheck.rows.length > 0) {
            return res.status(409).json({ success: false, message: "A logging session is already active for this device. Stop the old one first." });
        }

        // 📝 Create Session Record
        const storagePath = `tenants/${device.tenant_id}/devices/${device.id}/logs/`;
        const sessionRes = await pool.query(
            `INSERT INTO device_log_sessions (device_id, tenant_id, started_by, status, log_level, storage_path, last_chunk_number)
             VALUES ($1, $2, $3, 'active', $4, $5, 1)
             RETURNING id`,
            [device.id, device.tenant_id, userId, log_level, storagePath]
        );

        const sessionId = sessionRes.rows[0].id;

        // 🔗 Generate Initial Upload URL (Chunk 1)
        const uploadUrl = await generateUploadUrl(device.tenant_id, device.id, sessionId, 1);

        // 📡 Send Command to Device
        const commandPayload = {
            cmd: "start_logging",
            session_id: sessionId,
            level: log_level,
            upload_url: uploadUrl
        };

        await pool.query(
            "INSERT INTO commands (device_id, type, payload, status, created_by, expires_at) VALUES ($1,$2,$3,'queued',$4, NOW() + INTERVAL '1 hour')",
            [device.id, 'START_LOGGING', commandPayload, userId]
        );

        await logAudit(device.tenant_id, userId, "log.enable", "DEVICE", device.id, { session_id: sessionId, log_level });

        res.json({ success: true, session_id: sessionId, upload_url: uploadUrl });

    } catch (error) {
        console.error("StartLogSession Error:", error);
        res.status(500).json({ success: false, message: "Internal server error during session start.", error: error.message });
    }
};

/**
 * 3. Stop Log Session (Tenant Admin / Operator)
 */
exports.stopLogSession = async (req, res) => {
    const { session_id } = req.params;
    const { role: userRole, tenant_id: userTenantId, id: userId, roles = [] } = req.user;

    try {
        const sRes = await pool.query(
            "SELECT s.*, d.merchant_path FROM device_log_sessions s JOIN devices d ON s.device_id = d.id WHERE s.id = $1",
            [session_id]
        );

        if (sRes.rows.length === 0) return res.status(404).json({ success: false, message: "Session not found" });

        const session = sRes.rows[0];

        if (session.status !== 'active') {
            return res.status(400).json({ success: false, message: `Cannot stop session in '${session.status}' state.` });
        }

        // RBAC
        if (userRole !== "SUPER_ADMIN" && session.tenant_id !== userTenantId) {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        if (userRole === "OPERATOR") {
            const merchScope = roles.find(r => r.scope === "merchant");
            if (merchScope) {
                const userPath = normalizePath(merchScope.scope_path);
                const devicePath = normalizePath(session.merchant_path);
                if (!devicePath.startsWith(userPath)) {
                    return res.status(403).json({ success: false, message: "Forbidden" });
                }
            }
        }

        await pool.query("UPDATE device_log_sessions SET status = 'stopped', updated_at = NOW() WHERE id = $1", [session_id]);

        // 📡 Queue Stop Command
        const commandPayload = { cmd: "stop_logging", session_id };
        await pool.query(
            "INSERT INTO commands (device_id, type, payload, status, created_by, expires_at) VALUES ($1,$2,$3,'queued',$4, NOW() + INTERVAL '1 hour')",
            [session.device_id, 'STOP_LOGGING', commandPayload, userId]
        );

        await logAudit(session.tenant_id, userId, "log.disable", "DEVICE", session.device_id, { session_id });

        res.json({ success: true, message: "Stop command issued to device." });

    } catch (error) {
        console.error("StopLogSession Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

/**
 * 4. Get Log Sessions (Admin / Operator)
 */
exports.getLogSessions = async (req, res) => {
    try {
        const { device_id, status, limit = 50, offset = 0 } = req.query;
        const { role: userRole, tenant_id: userTenantId, roles = [] } = req.user;

        let query = `
            SELECT s.*, d.serial, d.model, u.email as started_by_email
            FROM device_log_sessions s
            JOIN devices d ON s.device_id = d.id
            LEFT JOIN users u ON s.started_by = u.id
            WHERE 1=1
        `;
        const params = [];

        if (userRole !== "SUPER_ADMIN") {
            params.push(userTenantId);
            query += ` AND s.tenant_id = $${params.length}`;
        }

        if (device_id) {
            params.push(device_id);
            query += ` AND s.device_id = $${params.length}`;
        }

        if (status) {
            params.push(status);
            query += ` AND s.status = $${params.length}`;
        }

        // Operator scope filtering
        if (userRole === "OPERATOR") {
            const merchScope = roles.find(r => r.scope === "merchant");
            if (merchScope) {
                const userPath = normalizePath(merchScope.scope_path);
                params.push(userPath);
                query += ` AND (COALESCE(d.merchant_path, '/') || '/') ILIKE $${params.length} || '%'`;
            }
        }

        const fLimit = parseInt(limit) || 50;
        const fOffset = parseInt(offset) || 0;
        const currentParamsCount = params.length;
        query += ` ORDER BY s.start_time DESC LIMIT $${currentParamsCount + 1} OFFSET $${currentParamsCount + 2}`;
        params.push(fLimit, fOffset);

        const result = await pool.query(query, params);
        await logAudit(userRole === "SUPER_ADMIN" ? null : userTenantId, req.user.id, "log.view", "DEVICE", null, { count: result.rows.length });
        res.json({ success: true, data: result.rows });

    } catch (error) {
        console.error("GetLogSessions Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

/**
 * 5. Get Session Chunks
 * GET /api/v1/audit/sessions/:session_id/chunks
 */
exports.getLogSessionChunks = async (req, res) => {
    const { session_id } = req.params;
    const { role: userRole, tenant_id: userTenantId, roles = [] } = req.user;

    try {
        const sRes = await pool.query(
            "SELECT s.*, d.merchant_path FROM device_log_sessions s JOIN devices d ON s.device_id = d.id WHERE s.id = $1",
            [session_id]
        );
        if (sRes.rows.length === 0) return res.status(404).json({ success: false, message: "Session not found" });

        const session = sRes.rows[0];

        // RBAC
        if (userRole !== "SUPER_ADMIN" && session.tenant_id !== userTenantId) {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        if (userRole === "OPERATOR") {
            const merchScope = roles.find(r => r.scope === "merchant");
            if (merchScope) {
                const userPath = normalizePath(merchScope.scope_path);
                const devicePath = normalizePath(session.merchant_path);
                if (!devicePath.startsWith(userPath)) return res.status(403).json({ success: false, message: "Forbidden" });
            }
        }

        const chunks = [];
        for (let i = 1; i <= session.last_chunk_number; i++) {
            chunks.push({
                chunk_number: i,
                name: `chunk_${i}.log`,
                path: `${session.storage_path}${session_id}/chunk_${i}.log`
            });
        }

        res.json({ success: true, session_id, chunks });
    } catch (error) {
        res.status(500).json({ success: false });
    }
};

/**
 * 6. Get Download URL for Specific Chunk
 */
exports.getLogDownloadUrl = async (req, res) => {
    const { session_id } = req.params;
    const { chunk_number = 1 } = req.query;
    const { role: userRole, tenant_id: userTenantId, id: userId, roles = [] } = req.user;

    try {
        const sRes = await pool.query(
            "SELECT s.*, d.merchant_path FROM device_log_sessions s JOIN devices d ON s.device_id = d.id WHERE s.id = $1",
            [session_id]
        );

        if (sRes.rows.length === 0) return res.status(404).json({ success: false, message: "Session not found" });

        const session = sRes.rows[0];

        // RBAC
        if (userRole !== "SUPER_ADMIN" && session.tenant_id !== userTenantId) {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        if (userRole === "OPERATOR") {
            const merchScope = roles.find(r => r.scope === "merchant");
            if (merchScope) {
                const userPath = normalizePath(merchScope.scope_path);
                const devicePath = normalizePath(session.merchant_path);
                if (!devicePath.startsWith(userPath)) return res.status(403).json({ success: false, message: "Forbidden" });
            }
        }

        const key = `${session.storage_path}${session_id}/chunk_${chunk_number}.log`;
        const downloadUrl = await generateDownloadUrl(key);

        await logAudit(session.tenant_id, userId, "log.download", "DEVICE", session.device_id, { session_id, chunk_number });

        res.json({ success: true, download_url: downloadUrl });

    } catch (error) {
        console.error("GetLogDownloadUrl Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

/**
 * 7. Device Callback: Get Next Chunk URL
 * Updates 'last_chunk_number' and 'updated_at' to track progress.
 */
exports.generateNextUploadUrl = async (req, res) => {
    const { session_id } = req.params;
    const { chunk_number } = req.body;
    const deviceId = req.user.id;

    if (!chunk_number) return res.status(400).json({ success: false, message: "chunk_number is required" });

    try {
        const sRes = await pool.query("SELECT * FROM device_log_sessions WHERE id = $1 AND device_id = $2", [session_id, deviceId]);
        if (sRes.rows.length === 0) return res.status(404).json({ success: false, message: "Session context mismatch" });

        const session = sRes.rows[0];
        if (session.status === 'uploaded' || session.status === 'failed') {
            return res.status(400).json({ success: false, message: "Session is already closed." });
        }

        const uploadUrl = await generateUploadUrl(session.tenant_id, session.device_id, session_id, chunk_number);

        // Track progress
        await pool.query(
            "UPDATE device_log_sessions SET last_chunk_number = $1, updated_at = NOW() WHERE id = $2",
            [chunk_number, session_id]
        );

        res.json({ success: true, upload_url: uploadUrl });
    } catch (error) {
        console.error("generateNextUploadUrl Error:", error);
        res.status(500).json({ success: false });
    }
};

/**
 * 8. Device Callback: Mark Session as Uploaded
 */
exports.completeLogSession = async (req, res) => {
    const { session_id } = req.params;
    const deviceId = req.user.id;

    try {
        const result = await pool.query(
            "UPDATE device_log_sessions SET status = 'uploaded', end_time = NOW(), updated_at = NOW() WHERE id = $1 AND device_id = $2 AND status IN ('active', 'stopped') RETURNING *",
            [session_id, deviceId]
        );

        if (result.rowCount === 0) return res.status(404).json({ success: false, message: "No active/stopped session found to complete." });

        console.log(`[LOG_SESSION] Session ${session_id} completed successfully for device ${deviceId}`);
        res.json({ success: true, message: "Session marked as uploaded" });
    } catch (error) {
        console.error("completeLogSession Error:", error);
        res.status(500).json({ success: false });
    }
};
