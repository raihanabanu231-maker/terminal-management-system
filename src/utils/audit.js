const pool = require("../config/db");

/**
 * Robust utility to record system and device logs.
 * Designed to never crash the main application flow.
 */
exports.logAudit = async (tenantId, userId, action, resourceType, resourceId, details = null) => {
    try {
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

        // 3. Save to System Audit Table
        try {
            await pool.query(
                `INSERT INTO audit_logs (tenant_id, tenant_name, user_id, action, resource_type, resource_id, details, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
                [tenantId, tenantName, userId, action, resourceType, resourceId, details ? JSON.stringify(details) : null]
            );
        } catch (e) { console.error("Audit System Log Insert Fail:", e.message); }

        // 4. Save to Device Audit Table (Mirror)
        if (resourceType === 'DEVICE' && resourceId) {
            try {
                const msg = `Action: ${action}${details ? ' - Details: ' + JSON.stringify(details) : ''}`.substring(0, 1000);
                await pool.query(
                    `INSERT INTO device_audit_logs (device_id, tenant_id, tenant_name, merchant_id, merchant_path, event_type, message, timestamp)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
                    [resourceId, tenantId, tenantName, merchantId, merchantPath, action, msg]
                );
            } catch (e) { console.error("Audit Device Log Insert Fail:", e.message); }
        }

    } catch (globalError) {
        console.error("FATAL AUDIT ERROR:", globalError.message);
    }
};
