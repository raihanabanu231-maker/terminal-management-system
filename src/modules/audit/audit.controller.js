const pool = require("../../config/db");
const { logAudit } = require("../../utils/audit");

// --- V7 HELPER: Normalization (Strict Formatting) ---
const normalizePath = (path) => {
    if (!path) return "/";
    let p = path.trim().toLowerCase();
    if (!p.startsWith("/")) p = "/" + p;
    if (!p.endsWith("/")) p = p + "/";
    return p;
};

/**
 * 1. Retrieve System Audit Logs (Internal/User Actions)
 * GET /api/v1/audit
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
 * 2. Retrieve Device Audit Logs (Android Generated)
 * GET /api/v1/audit/devices
 */
exports.getDeviceAuditLogs = async (req, res) => {
    try {
        const { role: userRole, tenant_id: userTenantId } = req.user;
        const { limit = 50, offset = 0, device_id } = req.query;

        const roles = req.user.roles || [];
        let userScopePath = "/";
        if (userRole !== "SUPER_ADMIN") {
            const merchantRoles = roles.filter(r => r.scope === "merchant");
            if (merchantRoles.length > 0) userScopePath = merchantRoles[0].scope_path;
        }

        let query = `
            SELECT dal.*, d.serial, d.model 
            FROM device_audit_logs dal
            LEFT JOIN devices d ON dal.device_id = d.id
            WHERE 1=1
        `;
        const params = [];

        if (userRole !== "SUPER_ADMIN") {
            params.push(userTenantId);
            query += ` AND dal.tenant_id = $${params.length}`;
        }

        if (userScopePath && userScopePath !== "/") {
            params.push(userScopePath);
            query += ` AND (COALESCE(dal.merchant_path, '/') || '/') ILIKE $${params.length} || '%'`;
        }

        if (device_id) {
            params.push(device_id);
            query += ` AND dal.device_id = $${params.length}`;
        }

        const fLimit = parseInt(limit) || 50;
        const fOffset = parseInt(offset) || 0;
        const currentParamsCount = params.length;
        query += ` ORDER BY dal.timestamp DESC LIMIT $${currentParamsCount + 1} OFFSET $${currentParamsCount + 2}`;
        params.push(fLimit, fOffset);

        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows, meta: { limit: fLimit, offset: fOffset, count: result.rows.length } });
    } catch (error) {
        console.error("GetDeviceAuditLogs Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

/**
 * 3. Receive Device Audit Logs (From Android)
 */
exports.receiveDeviceLogs = async (req, res) => {
    const { logs } = req.body;
    const deviceId = req.user.id;
    const tenantId = req.user.tenant_id;

    if (!Array.isArray(logs) || logs.length === 0) return res.status(400).json({ success: false, message: "Logs array is required" });

    try {
        const dRes = await pool.query(`
            SELECT d.merchant_id, d.merchant_path, d.tenant_name, t.audit_logging_enabled as t_audit, m.audit_logging_enabled as m_audit
            FROM devices d
            JOIN tenants t ON d.tenant_id = t.id
            LEFT JOIN merchants m ON d.merchant_id = m.id
            WHERE d.id = $1
        `, [deviceId]);

        if (dRes.rows.length > 0) {
            const dev = dRes.rows[0];
            const isEnabled = dev.m_audit !== null ? dev.m_audit : (dev.t_audit !== null ? dev.t_audit : true);
            
            if (!isEnabled) return res.status(200).json({ success: true, message: "Logging policy is OFF" });

            const client = await pool.connect();
            try {
                await client.query("BEGIN");
                for (const log of logs) {
                    await client.query(
                        `INSERT INTO device_audit_logs (device_id, tenant_id, tenant_name, merchant_id, merchant_path, event_type, message, timestamp)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                        [deviceId, tenantId, dev.tenant_name || 'System', dev.merchant_id, dev.merchant_path || '/', log.event_type || 'INFO', log.message || '', log.timestamp ? new Date(log.timestamp) : new Date()]
                    );
                }
                await client.query("COMMIT");
                res.status(201).json({ success: true, message: `Successfully stored ${logs.length} logs` });
            } catch (dbErr) {
                await client.query("ROLLBACK");
                throw dbErr;
            } finally {
                client.release();
            }
        } else {
            res.status(404).json({ success: false, message: "Device not found for log submission" });
        }
    } catch (error) {
        console.error("ReceiveDeviceLogs Error:", error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * 4. Toggle Audit Logging (Admins)
 */
exports.toggleAuditLogging = async (req, res) => {
    const { enabled, target_merchant_id } = req.body;
    const { tenant_id, role, id: userId, roles = [] } = req.user;

    if (typeof enabled !== "boolean") {
        return res.status(400).json({ success: false, message: "Boolean 'enabled' is required" });
    }

    try {
        const statusText = enabled ? "enabled" : "disabled";

        if (target_merchant_id) {
            // 🛡️ ROLE VALIDATION: Operator can toggle ONLY at Merchant level within their scope
            if (role === "OPERATOR") {
                const merchScope = roles.find(r => r.scope === "merchant");
                if (!merchScope) {
                    return res.status(403).json({ success: false, message: "Forbidden: Operator requires internal merchant scope." });
                }
                
                const targetMerchRes = await pool.query("SELECT name_path FROM merchants WHERE id = $1 AND tenant_id = $2", [target_merchant_id, tenant_id]);
                if (targetMerchRes.rows.length === 0) {
                    return res.status(404).json({ success: false, message: "Merchant not found." });
                }

                const userScope = normalizePath(merchScope.scope_path);
                const targetPath = normalizePath(targetMerchRes.rows[0].name_path);

                if (!targetPath.startsWith(userScope)) {
                    return res.status(403).json({ success: false, message: "Forbidden: Merchant is outside your assigned scope." });
                }
            } else if (role !== "TENANT_ADMIN" && role !== "SUPER_ADMIN") {
                return res.status(403).json({ success: false, message: "Unauthorized: Audit configuration requires Tenant Admin or Operator privileges" });
            }

            // Fetch old value for audit trail
            const oldValRes = await pool.query("SELECT audit_logging_enabled FROM merchants WHERE id = $1", [target_merchant_id]);
            const oldVal = (oldValRes.rows.length > 0) ? oldValRes.rows[0].audit_logging_enabled : null;

            // Toggle for specific merchant
            const result = await pool.query(
                "UPDATE merchants SET audit_logging_enabled = $1 WHERE id = $2 AND tenant_id = $3 RETURNING id",
                [enabled, target_merchant_id, tenant_id]
            );
            
            if (result.rowCount === 0) {
                return res.status(404).json({ success: false, message: "Merchant not found in your tenant" });
            }

            await logAudit(tenant_id, userId, "MERCHANT_AUDIT_TOGGLED", "MERCHANT", target_merchant_id, { 
                actor_role: role,
                target: "Merchant",
                old_value: oldVal === null ? "DEFAULT (true)" : oldVal,
                new_value: enabled,
                timestamp: new Date().toISOString()
            });
            
            return res.json({ 
                success: true, 
                message: `Audit logging ${statusText} successfully for Merchant.` 
            });
        } else {
            // Toggle for root tenant
            if (role !== "TENANT_ADMIN" && role !== "SUPER_ADMIN") {
                return res.status(403).json({ success: false, message: "Unauthorized: Root Audit configuration requires Tenant Admin privileges" });
            }

            // Fetch old value
            const oldValRes = await pool.query("SELECT audit_logging_enabled FROM tenants WHERE id = $1", [tenant_id]);
            const oldVal = (oldValRes.rows.length > 0) ? oldValRes.rows[0].audit_logging_enabled : true;

            const result = await pool.query(
                "UPDATE tenants SET audit_logging_enabled = $1 WHERE id = $2 RETURNING id",
                [enabled, tenant_id]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({ success: false, message: "Tenant not found" });
            }

            await logAudit(tenant_id, userId, "TENANT_AUDIT_TOGGLED", "TENANT", tenant_id, { 
                actor_role: role,
                target: "Tenant",
                old_value: oldVal,
                new_value: enabled,
                timestamp: new Date().toISOString()
            });
            
            return res.json({ 
                success: true, 
                message: `Audit logging ${statusText} successfully for Tenant.` 
            });
        }
    } catch (error) {
        console.error("ToggleAuditLogging Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

/**
 * 5. Get Audit Policy (Android Device Only)
 * GET /api/v1/audit/policy
 */
exports.getAuditPolicy = async (req, res) => {
    try {
        const deviceId = req.user.id;
        
        const dRes = await pool.query(`
            SELECT t.audit_logging_enabled as t_audit, m.audit_logging_enabled as m_audit
            FROM devices d
            JOIN tenants t ON d.tenant_id = t.id
            LEFT JOIN merchants m ON d.merchant_id = m.id
            WHERE d.id = $1
        `, [deviceId]);

        if (dRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Device not found" });
        }

        const dev = dRes.rows[0];
        // IF merchant audit setting exists → use it
        // ELSE IF tenant audit setting exists → use it
        // ELSE → true
        const isEnabled = dev.m_audit !== null ? dev.m_audit : (dev.t_audit !== null ? dev.t_audit : true);

        res.json({
            success: true,
            audit_logging_enabled: isEnabled
        });

    } catch (error) {
        console.error("GetAuditPolicy Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};
