const pool = require("../config/db");

/**
 * Per-Device Rate Limiter (Jayakumar Spec)
 * Tracks request count per device per endpoint in device_rate_limits table.
 * 
 * @param {string} endpoint - The endpoint name (e.g., 'heartbeat', 'command_poll')
 * @param {number} maxRequests - Max requests allowed per window
 * @param {number} windowMs - Window size in milliseconds (default: 60000 = 1 min)
 */
exports.deviceRateLimit = (endpoint, maxRequests, windowMs = 60000) => {
    return async (req, res, next) => {
        // Only apply to device tokens
        if (req.user?.role !== "DEVICE") {
            return next();
        }

        const deviceId = req.user.id;

        try {
            // Check if there's an existing rate limit window
            const existing = await pool.query(
                "SELECT request_count, window_start FROM device_rate_limits WHERE device_id = $1 AND endpoint = $2",
                [deviceId, endpoint]
            );

            const now = new Date();

            if (existing.rows.length === 0) {
                // First request — create entry
                await pool.query(
                    `INSERT INTO device_rate_limits (device_id, endpoint, request_count, window_start)
                     VALUES ($1, $2, 1, $3)
                     ON CONFLICT (device_id, endpoint) DO UPDATE SET request_count = 1, window_start = $3`,
                    [deviceId, endpoint, now]
                );
                return next();
            }

            const record = existing.rows[0];
            const windowStart = new Date(record.window_start);
            const windowEnd = new Date(windowStart.getTime() + windowMs);

            if (now > windowEnd) {
                // Window expired — reset counter
                await pool.query(
                    "UPDATE device_rate_limits SET request_count = 1, window_start = $1 WHERE device_id = $2 AND endpoint = $3",
                    [now, deviceId, endpoint]
                );
                return next();
            }

            if (record.request_count >= maxRequests) {
                // Rate limit exceeded
                return res.status(429).json({
                    success: false,
                    message: `Rate limit exceeded for ${endpoint}. Max ${maxRequests} requests per minute.`,
                    retry_after_ms: windowEnd.getTime() - now.getTime()
                });
            }

            // Increment counter
            await pool.query(
                "UPDATE device_rate_limits SET request_count = request_count + 1 WHERE device_id = $1 AND endpoint = $2",
                [deviceId, endpoint]
            );

            next();
        } catch (error) {
            console.error("Device Rate Limit Error:", error);
            // Don't block the request on rate limit errors
            next();
        }
    };
};
