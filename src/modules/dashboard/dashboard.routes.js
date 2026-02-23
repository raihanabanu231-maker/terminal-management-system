const express = require("express");
const router = express.Router();
const { getQuickMetrics } = require("./dashboard.controller");
const { verifyToken } = require("../../middleware/auth.middleware");

// Get Summary Dashboard (Protected)
router.get("/metrics", verifyToken, getQuickMetrics);

module.exports = router;
