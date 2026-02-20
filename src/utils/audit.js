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
exports.logAudit = async (tenantId, userId, action, resourceType, resourceId, newValues, oldValues = null) => {
    try {
        await pool.query(
            `INSERT INTO audit_logs 
       (tenant_id, user_id, action, resource_type, resource_id, new_values, old_values)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [tenantId, userId, action, resourceType, resourceId, JSON.stringify(newValues), oldValues ? JSON.stringify(oldValues) : null]
        );
    } catch (error) {
        console.error("Audit Logging Failed:", error);
        // We don't throw here to avoid crashing the main request flow
    }
};
