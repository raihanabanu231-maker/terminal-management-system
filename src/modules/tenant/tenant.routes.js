const express = require("express");
const router = express.Router();

const { createTenant, getTenants } = require("./tenant.controller");
const { verifyToken } = require("../../middleware/auth.middleware");
const { authorizeRoles } = require("../../middleware/role.middleware");

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
