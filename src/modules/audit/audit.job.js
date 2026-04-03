const pool = require("../../config/db");

/**
 * 🕒 Background Job: Auto-Failure Detection for Incomplete Log Sessions
 * Marks 'active' or 'stopped' sessions as 'failed' if they haven't seen 
 * any chunk updates/callbacks for more than 24 hours.
 */
const startAuditCleanupJob = () => {
    // Run every 10 minutes
    setInterval(async () => {
        try {
            console.log("[AUDIT_JOB] Checking for stalled logging sessions...");

            const result = await pool.query(`
                UPDATE device_log_sessions 
                SET status = 'failed', 
                    updated_at = NOW(),
                    end_time = COALESCE(end_time, NOW())
                WHERE (status = 'active' OR status = 'stopped')
                  AND updated_at < NOW() - INTERVAL '24 hours'
                RETURNING id
            `);

            if (result.rowCount > 0) {
                console.log(`[AUDIT_JOB] Auto-failed ${result.rowCount} stalled sessions.`);
                result.rows.forEach(row => {
                    console.log(` - Session ID: ${row.id} marked as FAILED due to timeout.`);
                });
            }

        } catch (error) {
            console.error("[AUDIT_JOB] Error during session cleanup:", error.message);
        }
    }, 600000); // 10 minutes
};

module.exports = { startAuditCleanupJob };
