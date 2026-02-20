const pool = require("../config/db");

/**
 * Log an audit event to the database.
 * @param {string} action - The action performed (e.g., "user.create", "device.enroll").
 * @param {number} actorId - ID of the user performing the action.
 * @param {string} targetId - ID of the target resource (e.g., userId, deviceId).
 * @param {string} targetType - Type of the target (e.g., "USER", "DEVICE", "ARTIFACT").
 * @param {Object} details - Additional JSON details about the event.
 * @param {string} ipAddress - IP address of the request.
 */
exports.logAudit = async (action, actorId, targetId, targetType, details, ipAddress) => {
    try {
        await pool.query(
            `INSERT INTO audit_logs (action, actor_id, target_id, target_type, details, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [action, actorId, targetId, targetType, JSON.stringify(details), ipAddress]
        );
        console.log(`📝 AUDIT: ${action} by User ${actorId} on ${targetType}:${targetId}`);
    } catch (error) {
        console.error("⚠️ Audit Log Error:", error);
        // We log error but don't throw, to avoid breaking the main flow
    }
};
