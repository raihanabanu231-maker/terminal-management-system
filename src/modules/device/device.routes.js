const express = require("express");
const router = express.Router();
const {
    generateEnrollmentToken,
    enrollDevice,
    sendDeviceCommand,
    getPendingCommands,
    ackCommand,
    getDevices,
    getDeviceById,
    updateDevice,
    deleteDevice,
    receiveHeartbeat,
    checkEnrollmentStatus,
    refreshDeviceToken
} = require("./device.controller");
const {
    reportIncident,
    reportTelemetry,
    getIncidents
} = require("./incident.controller");
const { verifyToken } = require("../../middleware/auth.middleware");
const { authorizeRoles } = require("../../middleware/role.middleware");
const { deviceRateLimit } = require("../../middleware/deviceRateLimit.middleware");

// =============================================
// FIXED PATHS FIRST (must come before /:id)
// =============================================

// Get All Devices (Dashboard List)
router.get(
    "/",
    verifyToken,
    authorizeRoles("TENANT_ADMIN", "OPERATOR", "VIEWER"),
    getDevices
);

// Device Pull: Pending Commands (called by device, max 60/min)
router.get(
    "/pending",
    verifyToken,
    authorizeRoles("DEVICE"),
    deviceRateLimit("command_poll", 60),
    getPendingCommands
);

// Generate Enrollment Token (QR Code) - Restricted to Tenant-level users
router.post(
    "/enroll-token",
    verifyToken,
    authorizeRoles("TENANT_ADMIN", "OPERATOR"),
    generateEnrollmentToken
);

// Check Enrollment Status (Polling endpoint)
router.get(
    "/enroll-token/:id/status",
    verifyToken,
    authorizeRoles("TENANT_ADMIN", "OPERATOR"),
    checkEnrollmentStatus
);

// Enroll Device (Public: Device calls this with Token)
router.post(
    "/enroll",
    enrollDevice
);

// Refresh Token (Public: Device calls this with Refresh Token)
router.post(
    "/refresh",
    refreshDeviceToken
);

// Device Heartbeat (called by device, max 120/min)
router.post("/heartbeat", verifyToken, authorizeRoles("DEVICE"), deviceRateLimit("heartbeat", 120), receiveHeartbeat);

// Incidents & Telemetry
router.post("/incidents", verifyToken, authorizeRoles("DEVICE"), reportIncident);
router.get("/incidents", verifyToken, authorizeRoles("TENANT_ADMIN", "OPERATOR", "VIEWER"), getIncidents);
router.post("/telemetry", verifyToken, authorizeRoles("DEVICE"), reportTelemetry);

// =============================================
// DYNAMIC PATHS (/:id, /:deviceId, /:commandId)
// =============================================

// Get Single Device (Detail Page) - Dynamic Auth: Locked for Guest Browse, but Private for hardware
router.get(
    "/:id",
    verifyToken,
    getDeviceById
);

// Send Remote Command - Restricted to Tenant-level users
router.post(
    "/:deviceId/command",
    verifyToken,
    authorizeRoles("TENANT_ADMIN", "OPERATOR"),
    sendDeviceCommand
);

// Device ACK: Confirm Command Execution (called by device)
router.post(
    "/:commandId/ack",
    verifyToken,
    authorizeRoles("DEVICE"),
    ackCommand
);

// Update Device
router.put(
    "/:id",
    verifyToken,
    authorizeRoles("TENANT_ADMIN", "OPERATOR", "SUPER_ADMIN"),
    updateDevice
);

// Delete Device
router.delete(
    "/:id",
    verifyToken,
    authorizeRoles("TENANT_ADMIN", "OPERATOR", "SUPER_ADMIN"),
    deleteDevice
);

module.exports = router;
