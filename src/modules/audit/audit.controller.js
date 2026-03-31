const pool = require("../../config/db");
const { logAudit } = require("../../utils/audit");

/**
 * 1. Retrieve System Audit Logs (Internal/User Actions)
 * GET /api/v1/audit
 */
exports.getAuditLogs = async (req, res) => {
    try {
        const { resource_type, action, user_id, limit = 50, offset = 0 } = req.query;
        const { role: userRole, tenant_id: tenantId } = req.user;

        let query = `
            SELECT al.*, u.email as user_email, t.name as tenant_name
            FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id
            LEFT JOIN tenants t ON al.tenant_id = t.id
            WHERE 1=1
        `;
        const params = [];

        // Scoping: Non-SuperAdmins only see their own tenant's logs
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

        query += ` ORDER BY al.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const result = await pool.query(query, params);

        res.json({ success: true, data: result.rows, meta: { limit: parseInt(limit), offset: parseInt(offset), count: result.rows.length } });

    } catch (error) {
        console.error("GetAuditLogs ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

/**
 * 2. Retrieve Device Audit Logs (Android Generated)
 * GET /api/v1/audit/devices
 */
// 4. View Device Event Logs (Hardware - Dashboard)
exports.getDeviceAuditLogs = async (req, res) => {
    try {
        const { role: userRole, tenant_id: userTenantId } = req.user;
        const { limit = 50, offset = 0, device_id } = req.query;

        // 🎯 V7 HELPER: Get User Scope Path
        const roles = req.user.roles || [];
        let userScopePath = "/";
        if (userRole !== "SUPER_ADMIN") {
            const merchantRoles = roles.filter(r => r.scope === "merchant");
            if (merchantRoles.length > 0) userScopePath = merchantRoles[0].scope_path;
        }

        let query = `
            SELECT dal.*, d.serial 
            FROM device_audit_logs dal
            LEFT JOIN devices d ON dal.device_id = d.id
            WHERE 1=1
        `;
        const params = [];

        // 🛡️ 1. SECURITY: Tenant Lockdown
        if (userRole !== "SUPER_ADMIN") {
            params.push(userTenantId);
            query += ` AND dal.tenant_id = $${params.length}`;
        }

        // 🛡️ 2. SECURITY: Hierarchical Scoping
        if (userScopePath !== "/") {
            params.push(userScopePath);
            query += ` AND (dal.merchant_path || '/') ILIKE $${params.length} || '%'`;
        }

        if (device_id) {
            params.push(device_id);
            query += ` AND dal.device_id = $${params.length}`;
        }

        // 3. Final Query Assembly (Fixing Indexing Conflicts Definitively)
        query += ` ORDER BY dal.timestamp DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);
        res.json({
            success: true,
            data: result.rows,
            meta: {
                limit: parseInt(limit),
                offset: parseInt(offset),
                count: result.rows.length
            }
        });
    } catch (error) {
        console.error("GetDeviceAuditLogs ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

/**
 * 3. Toggle Audit Logging (Admin Control)
 * PUT /api/v1/audit/config
 */
exports.toggleAuditLogging = async (req, res) => {
    const { enabled, target_merchant_id } = req.body;
    const { tenant_id, role, id: userId } = req.user;

    if (typeof enabled !== "boolean") return res.status(400).json({ success: false, message: "Boolean 'enabled' is required" });

    try {
        if (target_merchant_id) {
            // Update Merchant Level
            await pool.query(
                "UPDATE merchants SET audit_logging_enabled = $1 WHERE id = $2 AND tenant_id = $3",
                [enabled, target_merchant_id, tenant_id]
            );
            await logAudit(tenant_id, userId, "MERCHANT_AUDIT_TOGGLED", "MERCHANT", target_merchant_id, { enabled });
        } else {
            // Update Tenant Level
            if (role !== "TENANT_ADMIN" && role !== "SUPER_ADMIN") return res.status(403).json({ success: false, message: "Unauthorized" });
            await pool.query("UPDATE tenants SET audit_logging_enabled = $1 WHERE id = $2", [enabled, tenant_id]);
            await logAudit(tenant_id, userId, "TENANT_AUDIT_TOGGLED", "TENANT", tenant_id, { enabled });
        }

        res.json({ success: true, message: `Audit logging ${enabled ? 'enabled' : 'disabled'} successfully.` });
    } catch (error) {
        console.error("ToggleAuditLogging ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

/**
 * 4. Receive Device Audit Logs (From Android)
 * POST /api/v1/audit/devices/log
 */
exports.receiveDeviceLogs = async (req, res) => {
    const { logs } = req.body; // Expect array of { event_type, message, timestamp }
    const deviceId = req.user.id;
    const tenantId = req.user.tenant_id;

    if (!Array.isArray(logs) || logs.length === 0) return res.status(400).json({ success: false, message: "Logs array is required" });

    try {
        // 🛡️ SECURITY: Enforcement
        const configRes = await pool.query(`
            SELECT COALESCE(m.audit_logging_enabled, t.audit_logging_enabled) as audit_logging_enabled, d.merchant_id
            FROM devices d
            JOIN tenants t ON d.tenant_id = t.id
            LEFT JOIN merchants m ON d.merchant_id = m.id
            WHERE d.id = $1
        `, [deviceId]);

        const auditEnabled = configRes.rows[0]?.audit_logging_enabled ?? true;
        const merchantId = configRes.rows[0]?.merchant_id;

        if (!auditEnabled) {
            // Ignore logs if disabled
            return res.status(403).json({ success: false, message: "Audit logging is disabled for this store/tenant." });
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            // --- 🎯 NEW: Fetch Tenant Name ---
            const tNameRes = await client.query("SELECT name FROM tenants WHERE id = $1", [tenantId]);
            const tenantName = tNameRes.rows[0]?.name || "Unknown";

            for (const log of logs) {
                await client.query(
                    `INSERT INTO device_audit_logs (device_id, tenant_id, tenant_name, merchant_id, event_type, message, timestamp)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [deviceId, tenantId, tenantName, merchantId, log.event_type, log.message, log.timestamp || new Date()]
                );
            }
            await client.query("COMMIT");
            res.status(201).json({ success: true, message: `${logs.length} logs processed.` });
        } catch (dbErr) {
            await client.query("ROLLBACK");
            throw dbErr;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error("ReceiveDeviceLogs ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};
