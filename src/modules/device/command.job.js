const pool = require("../../config/db");

/**
 * 🕒 Command Timeout Job
 * Automatically marks 'queued' commands as 'failed' if they haven't 
 * been picked up by a device (via polling) within 1 minute.
 */
const startCommandTimeoutJob = () => {
    // Run every 20 seconds to be responsive
    setInterval(async () => {
        try {
            const result = await pool.query(`
                UPDATE commands 
                SET status = 'failed', 
                    last_error = 'Command timed out: Device did not poll within 1 minute.'
                WHERE status = 'queued'
                  AND created_at < NOW() - INTERVAL '1 minute'
                RETURNING id, device_id, type
            `);

            if (result.rowCount > 0) {
                console.log(`[COMMAND_JOB] Timed out ${result.rowCount} stale commands.`);
                result.rows.forEach(cmd => {
                    console.log(` - Command ${cmd.type} (ID: ${cmd.id}) for Device ${cmd.device_id} marked as FAILED.`);
                });
            }

        } catch (error) {
            console.error("[COMMAND_JOB] Error during command timeout cleanup:", error.message);
        }
    }, 20000); // 20 seconds
};

module.exports = { startCommandTimeoutJob };
