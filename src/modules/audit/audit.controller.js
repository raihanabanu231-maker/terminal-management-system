const pool = require("../../config/db");

/**
 * Retrieve audit logs with filtering and scoping
 * GET /api/v1/audit
 */
exports.getAuditLogs = async (req, res) => {
    try {
        const { resource_type, action, user_id, limit = 50, offset = 0 } = req.query;
        const userRole = req.user.role;
        const tenantId = req.user.tenant_id;

        let query = `
            SELECT al.*, u.email as user_email, t.name as tenant_name
            FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id
            LEFT JOIN tenants t ON al.tenant_id = t.id
        `;
        const params = [];

        // Scoping: Non-SuperAdmins only see their own tenant's logs
        if (userRole !== "SUPER_ADMIN") {
            params.push(tenantId);
            query += ` WHERE al.tenant_id = $${params.length}`;
        } else {
            query += ` WHERE 1=1`;
        }

        // Filtering
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
        console.error("GetAuditLogs ERROR:", error);
        res.status(500).json({ success: false, message: "Server error", detail: error.message });
    }
};
