const express = require("express");
const router = express.Router();
const multer = require("multer");
const { verifyToken } = require("../../middleware/auth.middleware");
const { authorizeRoles } = require("../../middleware/role.middleware");
const { uploadArtifact, approveArtifact, deployArtifact } = require("./artifact.controller");

const path = require("path");
const upload = multer({ dest: path.join(__dirname, "../../../uploads") });

// 1. Upload Draft (Super Admin Only)
router.post(
    "/upload",
    verifyToken,
    authorizeRoles("SUPER_ADMIN"),
    upload.single("file"),
    uploadArtifact
);

// 2. Publish Artifact (Super Admin Only)
router.post(
    "/:id/publish",
    verifyToken,
    authorizeRoles("SUPER_ADMIN"),
    approveArtifact
);

// 3. Deploy Artifact (Super Admin Only)
router.post(
    "/:id/deploy",
    verifyToken,
    authorizeRoles("SUPER_ADMIN"),
    deployArtifact
);

module.exports = router;
