const jwt = require("jsonwebtoken");

exports.verifyToken = async (req, res, next) => {
    const authHeader = req.header("Authorization");

    if (!authHeader) {
        return res.status(401).json({
            success: false,
            message: "Access Denied: No token provided",
        });
    }

    try {
        // Remove "Bearer " prefix if present
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

        const verified = jwt.verify(token, process.env.JWT_SECRET);

        const pool = require("../config/db"); // Moved pool definition outside the if/else for efficiency

        // 🎯 Skip session check for DEVICE tokens, BUT enforce Hardware Revocation!
        if (verified.role === "DEVICE") {
            const crypto = require("crypto");
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
            
            const deviceCheck = await pool.query(
                "SELECT id FROM devices WHERE device_token_hash = $1 AND deleted_at IS NULL AND token_revoked_at IS NULL",
                [tokenHash]
            );

            if (deviceCheck.rows.length === 0) {
                return res.status(401).json({
                    success: false,
                    message: "Hardware Access Revoked. Device token is invalid or has been wiped.",
                });
            }
        } else {
            // TC-LOGOUT-02 — Mandatory Session Validity Check
            // Ensures that if a user logs out, their Access Token is killed immediately.
            const sessionCheck = await pool.query(
                "SELECT id FROM user_sessions WHERE user_id = $1 AND jti = $2 AND invalidated_at IS NULL",
                [verified.id, verified.jti]
            );

            if (sessionCheck.rows.length === 0) {
                return res.status(401).json({
                    success: false,
                    message: "Session revoked. Please login again.",
                });
            }
        }

        req.user = verified;
        next();
    } catch (error) {
        console.error("TOKEN_VERIFICATION_ERROR:", error.message);
        res.status(401).json({
            success: false,
            message: error.message === "jwt expired" ? "Token expired" : "Invalid Token",
            detail: error.message
        });
    }
};
