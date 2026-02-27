const jwt = require("jsonwebtoken");

exports.verifyToken = (req, res, next) => {
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
