const express = require("express");
const router = express.Router();
const {
    createArtifact,
    uploadArtifact,
    approveArtifact,
    getArtifacts,
    getArtifactById,
    deprecateArtifact
} = require("./artifact.controller");
const { verifyToken } = require("../../middleware/auth.middleware");
const { authorizeRoles } = require("../../middleware/role.middleware");

// List Artifacts
router.get(
    "/",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN", "OPERATOR", "VIEWER"),
    getArtifacts
);

// Upload Artifact File (Step 1)
router.post(
    "/upload",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN"),
    uploadArtifact
);

// Create Artifact Metadata (Step 2)
router.post(
    "/",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN"),
    createArtifact
);

// Approve Artifact (Step 3) — must come before /:id
router.post(
    "/:id/approve",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN"),
    approveArtifact
);

// Deprecate Artifact
router.post(
    "/:id/deprecate",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN"),
    deprecateArtifact
);

// Get Single Artifact (must be last dynamic route)
router.get(
    "/:id",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN", "OPERATOR", "VIEWER"),
    getArtifactById
);

module.exports = router;
