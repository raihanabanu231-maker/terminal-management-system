const express = require("express");
const router = express.Router();
const {
    createDeployment,
    getDeployments,
    getDeploymentById,
    reportDeploymentEvent
} = require("./deployment.controller");
const { verifyToken } = require("../../middleware/auth.middleware");
const { authorizeRoles } = require("../../middleware/role.middleware");

// List Deployments
router.get(
    "/",
    verifyToken,
    authorizeRoles("TENANT_ADMIN", "OPERATOR", "VIEWER"),
    getDeployments
);

// Create Deployment
router.post(
    "/",
    verifyToken,
    authorizeRoles("TENANT_ADMIN"),
    createDeployment
);

// Device reports deployment event (called by device)
router.post(
    "/event",
    verifyToken,
    reportDeploymentEvent
);

// Get Deployment Details (must be after /event)
router.get(
    "/:id",
    verifyToken,
    authorizeRoles("TENANT_ADMIN", "OPERATOR", "VIEWER"),
    getDeploymentById
);

module.exports = router;
