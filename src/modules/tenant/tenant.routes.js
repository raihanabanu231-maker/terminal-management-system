const express = require("express");
const router = express.Router();

const { createTenant, getTenants, getMyTenant } = require("./tenant.controller");
const { verifyToken } = require("../../middleware/auth.middleware");
const { authorizeRoles } = require("../../middleware/role.middleware");

// Get My Company Info
router.get(
  "/me",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN", "OPERATOR", "VIEWER"),
  getMyTenant
);

// Create Tenant
router.post(
  "/",
  verifyToken,
  authorizeRoles("SUPER_ADMIN"),
  createTenant
);

// Get Tenants
router.get(
  "/",
  verifyToken,
  authorizeRoles("SUPER_ADMIN"),
  getTenants
);

module.exports = router;
