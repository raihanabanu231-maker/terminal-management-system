const pool = require("../config/db");

/**
 * Standard utility to log administrative and device-level actions.
 * Mirrored insertion into both audit_logs and device_audit_logs (for device-specific resource types).
 */
exports.logAudit = async (tenantId, userId, action, resourceType, resourceId, details = null) => {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // 1. Resolve Global Identities
        const tenantNameRes = await pool.query("SELECT name FROM tenants WHERE id = $1", [tenantId]);
        const tenantName = tenantNameRes.rows[0]?.name || 'System';

        // 2. Insert into System Audit Logs
        await client.query(
            `INSERT INTO audit_logs (tenant_id, tenant_name, user_id, action, resource_type, resource_id, details, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
            [tenantId, tenantName, userId, action, resourceType, resourceId, details ? JSON.stringify(details) : null]
        );

        // 3. Mirror to Device Audit Logs (if target is a DEVICE)
        if (resourceType === 'DEVICE' && resourceId) {
            const devRes = await pool.query("SELECT merchant_id, merchant_path FROM devices WHERE id = $1", [resourceId]);
            if (devRes.rows.length > 0) {
                const { merchant_id, merchant_path } = devRes.rows[0];
                const cleanMsg = `Action: ${action}${details ? ' - Info: ' + (typeof details === 'string' ? details : JSON.stringify(details)).substring(0, 500) : ''}`;
                
                await client.query(
                    `INSERT INTO device_audit_logs (device_id, tenant_id, tenant_name, merchant_id, merchant_path, event_type, message, timestamp)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
                    [resourceId, tenantId, tenantName, merchant_id, merchant_path || '/', action, cleanMsg]
                );
            }
        }

        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("logAudit ERROR:", error);
    } finally {
        client.release();
    }
};
