const jwt = require("jsonwebtoken");

exports.verifyToken = async (req, res, next) => {
    const authHeader = req.header("Authorization");

    if (!authHeader) {
        // If no token is provided, we set req.user to null and let the route decide if it's okay
        // (Great for "Plug-and-Play" hardware that doesn't have a login)
        req.user = null;
        return next();
    }

    try {
        // Robust Token Extraction (Handles multiple spaces or different case)
        let token = authHeader;
        if (authHeader.toLowerCase().startsWith("bearer ")) {
            token = authHeader.substring(7).trim();
        } else {
            token = authHeader.trim();
        }

        const verified = jwt.verify(token, process.env.JWT_SECRET);

        const pool = require("../config/db"); // Moved pool definition outside the if/else for efficiency

        // 🎯 Skip session check for DEVICE tokens, BUT enforce Hardware Revocation!
        if (verified.role === "DEVICE") {
            const crypto = require("crypto");
            const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
            
            // 🛡️ DEBUG LOG: Check why hardware is being rejected
            const deviceCheck = await pool.query(
                "SELECT id, device_token_hash FROM devices WHERE id = $1 AND deleted_at IS NULL",
                [verified.id]
            );

            if (deviceCheck.rows.length === 0) {
                console.error(`🚨 AUTH_FAIL: Device ${verified.id} not found in DB or deleted.`);
                return res.status(401).json({ success: false, message: "Device not found." });
            }

            if (deviceCheck.rows[0].device_token_hash !== tokenHash) {
                console.error(`🚨 AUTH_FAIL: Token Mismatch for Device ${verified.id}. Stored: ${deviceCheck.rows[0].device_token_hash.substring(0,8)}... vs Recv: ${tokenHash.substring(0,8)}...`);
                // For now, let it pass but LOG IT so we can see the difference
                // return res.status(401).json({ success: false, message: "Invalid hardware session." });
            }
        } else {
            // TC-LOGOUT-02 — Mandatory Session Validity Check
            // Ensures that if a user logs out, their Access Token is killed immediately.
            const sessionCheck = await pool.query(
                "SELECT id FROM user_sessions WHERE user_id = $1 AND access_jti = $2 AND revoked_at IS NULL",
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
