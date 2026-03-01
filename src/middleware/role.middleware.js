exports.authorizeRoles = (...roles) => {
  return (req, res, next) => {
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
