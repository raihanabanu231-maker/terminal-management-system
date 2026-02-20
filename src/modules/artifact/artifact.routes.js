const express = require("express");
const router = express.Router();
const multer = require("multer");
const { verifyToken } = require("../../middleware/auth.middleware");
const { uploadArtifact, approveArtifact, deployArtifact } = require("./artifact.controller");

const path = require("path");
const upload = multer({ dest: path.join(__dirname, "../../../uploads") });

// 1. Upload Draft (Admin Only)
router.post(
    "/upload",
    verifyToken,
    upload.single("file"),
    uploadArtifact
);

// 2. Publish Artifact (Approver Role Required)
router.post(
    "/:id/publish",
    verifyToken,
    approveArtifact
);

// 3. Deploy Artifact (Admin)
router.post(
    "/:id/deploy",
    verifyToken,
    deployArtifact
);

module.exports = router;
