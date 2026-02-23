const express = require("express");
const router = express.Router();
const { generateEnrollmentToken, enrollDevice, sendDeviceCommand, getPendingCommands } = require("./device.controller");
const { verifyToken } = require("../../middleware/auth.middleware");

// Generate Token (Protected: Only Admins/Operators can do this)
router.post(
    "/enroll-token",
    verifyToken,
    generateEnrollmentToken
);

// Enroll Device (Public: Device calls this with Token)
router.post(
    "/enroll",
    enrollDevice
);

// Remote Command (Protected)
router.post(
    "/:deviceId/command",
    verifyToken,
    sendDeviceCommand
);

// Device Pull: Pending Commands (Protected - called by device)
router.get(
    "/pending",
    verifyToken,
    getPendingCommands
);

module.exports = router;
