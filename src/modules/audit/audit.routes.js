const express = require("express");
const router = express.Router();
const { getAuditLogs } = require("./audit.controller");
const { verifyToken, authorizeRoles } = require("../../middleware/auth.middleware");

// Get Audit Logs (Restricted to Super Admin and Tenant Admin)
router.get(
    "/",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN"),
    getAuditLogs
);

module.exports = router;
