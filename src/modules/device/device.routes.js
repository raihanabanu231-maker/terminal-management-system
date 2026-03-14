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
    receiveHeartbeat
} = require("./device.controller");
const {
    reportIncident,
    reportTelemetry,
    getIncidents
} = require("./incident.controller");
const { verifyToken } = require("../../middleware/auth.middleware");
const { authorizeRoles } = require("../../middleware/role.middleware");

// =============================================
// FIXED PATHS FIRST (must come before /:id)
// =============================================

// Get All Devices (Dashboard List)
router.get(
    "/",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN", "OPERATOR", "VIEWER"),
    getDevices
);

// Device Pull: Pending Commands (called by device)
router.get(
    "/pending",
    verifyToken,
    getPendingCommands
);

// Generate Enrollment Token (QR Code)
router.post(
    "/enroll-token",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN", "OPERATOR"),
    generateEnrollmentToken
);

// Enroll Device (Public: Device calls this with Token)
router.post(
    "/enroll",
    enrollDevice
);

// Device Heartbeat (called by device)
router.post("/heartbeat", verifyToken, receiveHeartbeat);

// Incidents & Telemetry
router.post("/incidents", verifyToken, reportIncident);
router.get("/incidents", verifyToken, authorizeRoles("SUPER_ADMIN"), getIncidents);
router.post("/telemetry", verifyToken, reportTelemetry);

// =============================================
// DYNAMIC PATHS (/:id, /:deviceId, /:commandId)
// =============================================

// Get Single Device (Detail Page)
router.get(
    "/:id",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN", "OPERATOR", "VIEWER"),
    getDeviceById
);

// Send Remote Command
router.post(
    "/:deviceId/command",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN", "OPERATOR"),
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
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN"),
    updateDevice
);

// Delete Device
router.delete(
    "/:id",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN"),
    deleteDevice
);

module.exports = router;
