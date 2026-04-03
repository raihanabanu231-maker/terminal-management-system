const express = require("express");
const router = express.Router();
const { 
    getAuditLogs, 
    getLogSessions, 
    getLogSessionChunks,
    startLogSession, 
    stopLogSession, 
    getLogDownloadUrl,
    generateNextUploadUrl,
    completeLogSession
} = require("./audit.controller");
const { verifyToken } = require("../../middleware/auth.middleware");
const { authorizeRoles } = require("../../middleware/role.middleware");

// 1. Get System Audit Logs
router.get(
    "/",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN"),
    getAuditLogs
);

// --- NEW LOGGING SYSTEM ---

// 2. List Logging Sessions
router.get(
    "/sessions",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN", "OPERATOR"),
    getLogSessions
);

// 2b. List Chunks for a Session
router.get(
    "/sessions/:session_id/chunks",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN", "OPERATOR"),
    getLogSessionChunks
);

// 3. Start Logging Session
router.post(
    "/sessions/start",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN", "OPERATOR"),
    startLogSession
);

// 4. Stop Logging Session
router.post(
    "/sessions/:session_id/stop",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN", "OPERATOR"),
    stopLogSession
);

// 5. Download Specific Chunk
router.get(
    "/sessions/:session_id/download",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN", "OPERATOR"),
    getLogDownloadUrl
);

// --- DEVICE CALLBACKS (Role: DEVICE) ---

// 6. Get Next Chunk Upload URL (Tracks progress)
router.post(
    "/sessions/:session_id/upload-url",
    verifyToken,
    authorizeRoles("DEVICE"),
    generateNextUploadUrl
);

// 7. Mark Session as Completed/Uploaded
router.post(
    "/sessions/:session_id/complete",
    verifyToken,
    authorizeRoles("DEVICE"),
    completeLogSession
);

module.exports = router;
