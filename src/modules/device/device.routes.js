const express = require("express");
const router = express.Router();
const {
    generateEnrollmentToken,
    enrollDevice,
    sendDeviceCommand,
    getPendingCommands,
    ackCommand,
    getDevices,
    updateDevice,
    deleteDevice
} = require("./device.controller");
const {
    reportIncident,
    reportTelemetry,
    getIncidents
} = require("./incident.controller");
const { verifyToken } = require("../../middleware/auth.middleware");
const { authorizeRoles } = require("../../middleware/role.middleware");

// Get All Devices (Protected: Super Admin, Tenant Admin, Operator, Viewer)
router.get(
    "/",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN", "OPERATOR", "VIEWER"),
    getDevices
);

// Get Single Device (For Detail Page)
const { getDeviceById } = require("./device.controller");
router.get(
    "/:id",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN", "OPERATOR", "VIEWER"),
    getDeviceById
);

// Generate Token (Protected: Super, Tenant, and Operators)
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

// Remote Command (Protected: Super Admin Only)
router.post(
    "/:deviceId/command",
    verifyToken,
    authorizeRoles("SUPER_ADMIN"),
    sendDeviceCommand
);

// Device Pull: Pending Commands (Protected - called by device)
router.get(
    "/pending",
    verifyToken,
    getPendingCommands
);

// Device ACK: Confirm Command Execution (Protected - called by device)
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

// 🚨 Incidents & Telemetry (Week 3)
router.post("/incidents", verifyToken, reportIncident);
router.get("/incidents", verifyToken, authorizeRoles("SUPER_ADMIN"), getIncidents);
router.post("/telemetry", verifyToken, reportTelemetry);

// 💓 Heartbeat (Week 2 - Device Health)
const { receiveHeartbeat } = require("./device.controller");
router.post("/heartbeat", verifyToken, receiveHeartbeat);

module.exports = router;
