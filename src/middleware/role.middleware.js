exports.authorizeRoles = (...roles) => {
  return (req, res, next) => {
    // 🛡️ SECURITY: Explicit handle for unauthenticated Guests (req.user = null)
    if (!req.user) {
        return res.status(401).json({ success: false, message: "Authorization Required: Please provide a valid login token." });
    }

    console.log(`[ROLE DEBUG] User Role: ${req.user.role} | Allowed: ${roles.join(", ")}`);
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You don't have permission"
      });
    }
    next();
  };
};
