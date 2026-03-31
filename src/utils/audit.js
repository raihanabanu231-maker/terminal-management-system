const pool = require("../config/db");
const crypto = require("crypto");

/**
 * Indestructible utility to record system and device logs.
 * Now manually generates UUIDs to prevent database-specific rejection.
 */
exports.logAudit = async (tenantId, userId, action, resourceType, resourceId, details = null) => {
    try {
        const logId = crypto.randomUUID();
        
        // 1. Resolve Tenant Name (Safe fallback)
        let tenantName = 'System';
        if (tenantId) {
            try {
                const tRes = await pool.query("SELECT name FROM tenants WHERE id = $1", [tenantId]);
                if (tRes.rows.length > 0) tenantName = tRes.rows[0].name;
            } catch (e) { console.error("Audit Tenant Lookup Fail:", e.message); }
        }

        // 2. Resolve Device Context (if applicable)
        let merchantId = null;
        let merchantPath = '/';
        if (resourceType === 'DEVICE' && resourceId) {
            try {
                const dRes = await pool.query("SELECT merchant_id, merchant_path FROM devices WHERE id = $1", [resourceId]);
                if (dRes.rows.length > 0) {
                    merchantId = dRes.rows[0].merchant_id;
                    merchantPath = dRes.rows[0].merchant_path || '/';
                }
            } catch (e) { console.error("Audit Device Lookup Fail:", e.message); }
        }

        // 3. Save to System Audit Table (Explicit ID)
        try {
            await pool.query(
                `INSERT INTO audit_logs (id, tenant_id, tenant_name, user_id, action, resource_type, resource_id, new_values, old_values, checksum, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
                [
                    logId, 
                    tenantId, 
                    tenantName, 
                    userId, 
                    action, 
                    resourceType, 
                    resourceId, 
                    details ? JSON.stringify(details) : '{}',
                    details?.old_values ? JSON.stringify(details.old_values) : null,
                    'tms-safe-' + crypto.randomBytes(4).toString('hex')
                ]
            );
        } catch (e) { console.error("Audit System Log Insert Fail:", e.message); }

        // 4. Save to Device Audit Table (Explicit ID)
        if (resourceType === 'DEVICE' && resourceId) {
            const devLogId = crypto.randomUUID();
            try {
                const msg = `Action: ${action}${details ? ' - Details: ' + JSON.stringify(details) : ''}`.substring(0, 1000);
                await pool.query(
                    `INSERT INTO device_audit_logs (id, device_id, tenant_id, tenant_name, merchant_id, merchant_path, event_type, message, timestamp)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
                    [devLogId, resourceId, tenantId, tenantName, merchantId, merchantPath, action, msg]
                );
            } catch (e) { console.error("Audit Device Log Insert Fail:", e.message); }
        }

    } catch (globalError) {
        console.error("FATAL AUDIT ERROR:", globalError.message);
    }
};
