const express = require("express");
const router = express.Router();

const { createTenant, getTenants, updateTenant, deleteTenant } = require("./tenant.controller");
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

// Update Tenant
router.put(
  "/:id",
  verifyToken,
  authorizeRoles("SUPER_ADMIN"),
  updateTenant
);

// Delete Tenant
router.delete(
  "/:id",
  verifyToken,
  authorizeRoles("SUPER_ADMIN"),
  deleteTenant
);

module.exports = router;
