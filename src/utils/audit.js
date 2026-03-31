const crypto = require("crypto");
const pool = require("../config/db");

/**
 * Log a system action to the audit_logs table
 * @param {string} tenantId - The UUID of the tenant
 * @param {string} userId - The UUID of the user (actor)
 * @param {string} action - The action string (e.g. 'user.invite')
 * @param {string} resourceType - The type of resource (e.g. 'device', 'user')
 * @param {string} resourceId - The UUID of the target resource
 * @param {object} newValues - The state of the resource after change
 * @param {object} oldValues - The state of the resource before change
 */
const SYSTEM_TENANT_ID = "f8261f95-d148-4c77-9e80-d254129a8843";

exports.logAudit = async (tenantId, userId, action, resourceType, resourceId, newValues, oldValues = null) => {
    try {
        const timestamp = new Date().toISOString();
        
        // --- 🛡️ SECURITY FALLBACKS ---
        const finalTenantId = tenantId || SYSTEM_TENANT_ID;
        const finalResourceId = resourceId || "00000000-0000-0000-0000-000000000000"; // Null-safe UUID for system-level actions
        
        // --- 🎯 NEW: Fetch Tenant Name for direct column population ---
        const tNameRes = await pool.query("SELECT name FROM tenants WHERE id = $1", [finalTenantId]);
        const tenantName = tNameRes.rows[0]?.name || "Unknown Tenant";

        const payload = JSON.stringify({
            tenant_id: finalTenantId,
            tenant_name: tenantName,
            user_id: userId,
            action,
            resource_type: resourceType,
            resource_id: finalResourceId,
            new_values: newValues,
            old_values: oldValues,
            timestamp
        });

        const checksum = crypto
            .createHmac("sha256", process.env.JWT_SECRET || "default_secret")
            .update(payload)
            .digest("hex");

        await pool.query(
            `INSERT INTO audit_logs 
               (tenant_id, tenant_name, user_id, action, resource_type, resource_id, new_values, old_values, checksum)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                finalTenantId,
                tenantName,
                userId,
                action,
                resourceType,
                finalResourceId,
                JSON.stringify(newValues),
                oldValues ? JSON.stringify(oldValues) : null,
                checksum
            ]
        );

        // 🎯 V7 ARCHITECT SYNC: Force Mirroring to device_audit_logs (Hardware History)
        if (resourceType === "DEVICE" && finalResourceId !== "00000000-0000-0000-0000-000000000000") {
            try {
                // Fetch current device context for scoping
                const devRes = await pool.query(
                    "SELECT tenant_id, merchant_id, merchant_path FROM devices WHERE id = $1", 
                    [finalResourceId]
                );
                
                if (devRes.rows.length > 0) {
                    // --- 🎯 NEW: Use descriptive message from newValues if present ---
                    const descriptiveMessage = newValues?.message 
                        ? newValues.message 
                        : `Hardware Event: ${action} | User: ${userId || 'SYSTEM'}`;

                    await pool.query(
                        `INSERT INTO device_audit_logs 
                           (device_id, tenant_id, tenant_name, merchant_id, merchant_path, event_type, message, timestamp) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
                        [
                            finalResourceId,
                            tId || finalTenantId,
                            tenantName,
                            mId || null,
                            mPath || "/",
                            String(action).substring(0, 50), 
                            descriptiveMessage
                        ]
                    );
                }
            } catch (hwError) {
                console.error("CRITICAL: Hardware Audit Mirroring FAILED:", hwError.message);
                // Non-blocking failure to avoid crashing the main request
            }
        }
    } catch (error) {
        console.error("Audit Logging Failed:", error);
    }
};

