const express = require("express");
const router = express.Router();
const { getQuickMetrics } = require("./dashboard.controller");
const { verifyToken } = require("../../middleware/auth.middleware");
const { authorizeRoles } = require("../../middleware/role.middleware");

// Get Summary Dashboard (Protected: Super Admin Only)
router.get("/metrics", verifyToken, authorizeRoles("SUPER_ADMIN"), getQuickMetrics);

module.exports = router;
