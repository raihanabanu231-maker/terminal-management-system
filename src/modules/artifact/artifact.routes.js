const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const {
    uploadArtifact,
    approveArtifact,
    getArtifacts,
    deleteArtifact
} = require("./artifact.controller");
const { verifyToken } = require("../../middleware/auth.middleware");
const { authorizeRoles } = require("../../middleware/role.middleware");

// --- MULTER STORAGE CONFIG ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "uploads/artifacts/");
    },
    filename: (req, file, cb) => {
        // Create a unique name: timestamp-originalName
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit (Adjust for big firmware)
});

// List Artifacts
router.get(
    "/",
    verifyToken,
    authorizeRoles("TENANT_ADMIN", "OPERATOR", "VIEWER", "SUPER_ADMIN"),
    getArtifacts
);

/**
 * 🚀 ARTIFACT FLOW - STEP 1 & 2: UPLOAD & REGISTER
 * POST /v1/artifacts/upload
 * Multi-part/form-data:
 *   - file: (The binary artifact)
 *   - name: "My App"
 *   - version: "1.0.1"
 *   - type: "app" or "firmware"
 */
router.post(
    "/upload",
    verifyToken,
    authorizeRoles("TENANT_ADMIN", "SUPER_ADMIN"),
    upload.single("file"),
    uploadArtifact
);

// 🚀 ARTIFACT FLOW - STEP 3: APPROVE
router.post(
    "/:id/approve",
    verifyToken,
    authorizeRoles("TENANT_ADMIN", "OPERATOR"),
    approveArtifact
);

// Delete Artifact
router.delete(
    "/:id",
    verifyToken,
    authorizeRoles("TENANT_ADMIN", "SUPER_ADMIN"),
    deleteArtifact
);

module.exports = router;
