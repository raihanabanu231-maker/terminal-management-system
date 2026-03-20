const express = require("express");
const router = express.Router();
const {
    createDeployment,
    getDeploymentStatus,
    reportDeploymentEvent
} = require("./deployment.controller");
const { verifyToken } = require("../../middleware/auth.middleware");
const { authorizeRoles } = require("../../middleware/role.middleware");

// --- ADMIN ROUTES ---

// 1. Create a New Deployment Campaign
router.post(
    "/",
    verifyToken,
    authorizeRoles("TENANT_ADMIN", "SUPER_ADMIN"),
    createDeployment
);

// 2. Track Real-time Progress (Total / Completed / Failed)
router.get(
    "/:id/status",
    verifyToken,
    authorizeRoles("TENANT_ADMIN", "OPERATOR", "VIEWER", "SUPER_ADMIN"),
    getDeploymentStatus
);

// --- DEVICE ROUTES ---

/**
 * 🚀 DEPLOYMENT FLOW - STEP 4: Reporting Progress
 * The Android device calls this when it starts/finishes a download.
 */
router.post(
    "/event",
    verifyToken,
    authorizeRoles("DEVICE"),
    reportDeploymentEvent
);

module.exports = router;
