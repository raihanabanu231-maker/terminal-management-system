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
    checkEnrollmentStatus
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

// Device Heartbeat (called by device, max 120/min)
router.post("/heartbeat", verifyToken, deviceRateLimit("heartbeat", 120), receiveHeartbeat);

// Incidents & Telemetry
router.post("/incidents", verifyToken, reportIncident);
router.get("/incidents", verifyToken, authorizeRoles("TENANT_ADMIN", "OPERATOR", "VIEWER"), getIncidents);
router.post("/telemetry", verifyToken, reportTelemetry);

// =============================================
// DYNAMIC PATHS (/:id, /:deviceId, /:commandId)
// =============================================

// Get Single Device (Detail Page)
router.get(
    "/:id",
    verifyToken,
    authorizeRoles("TENANT_ADMIN", "OPERATOR", "VIEWER"),
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
    ackCommand
);

// Update Device
router.put(
    "/:id",
    verifyToken,
    authorizeRoles("TENANT_ADMIN"),
    updateDevice
);

// Delete Device
router.delete(
    "/:id",
    verifyToken,
    authorizeRoles("TENANT_ADMIN"),
    deleteDevice
);

module.exports = router;
