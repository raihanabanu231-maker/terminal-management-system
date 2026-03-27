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
        
        const payload = JSON.stringify({
            tenant_id: finalTenantId,
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
               (tenant_id, user_id, action, resource_type, resource_id, new_values, old_values, checksum)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                finalTenantId,
                userId,
                action,
                resourceType,
                finalResourceId,
                JSON.stringify(newValues),
                oldValues ? JSON.stringify(oldValues) : null,
                checksum
            ]
        );
    } catch (error) {
        console.error("Audit Logging Failed:", error);
    }
};

