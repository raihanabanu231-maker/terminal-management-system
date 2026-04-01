const express = require("express");
const router = express.Router();
const { 
    getAuditLogs, 
    getDeviceAuditLogs, 
    toggleAuditLogging, 
    receiveDeviceLogs, 
    getAuditPolicy 
} = require("./audit.controller");
const { verifyToken } = require("../../middleware/auth.middleware");
const { authorizeRoles } = require("../../middleware/role.middleware");

// 1. Get User/System Audit Logs (Admins)
router.get(
    "/",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN"),
    getAuditLogs
);

// 2. Get Android Device Audit Logs (Admins/Operators)
router.get(
    "/devices",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN", "OPERATOR", "DEVICE"),
    getDeviceAuditLogs
);

// 3. Toggle Device Audit Logging (Admins/Operators)
router.put(
    "/config",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN", "OPERATOR"),
    toggleAuditLogging
);

// 4. Submit Android Device Logs (Android Device Only)
// Note: This endpoint is protected by DEVICE role. 
// It enforces the 'audit_logging_enabled' flag at the API level.
router.post(
    "/devices/log",
    verifyToken,
    authorizeRoles("DEVICE"),
    receiveDeviceLogs
);

// 5. Get Audit Policy (Android Device Only)
router.get(
    "/policy",
    verifyToken,
    authorizeRoles("DEVICE"),
    getAuditPolicy
);

module.exports = router;
