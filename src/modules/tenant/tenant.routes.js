const express = require("express");
const router = express.Router();

const { createTenant } = require("./tenant.controller");
const { verifyToken } = require("../../middleware/auth.middleware");
const { authorizeRoles } = require("../../middleware/role.middleware");

router.post(
  "/",
  verifyToken,
  authorizeRoles("SUPER_ADMIN"),
  createTenant
);

module.exports = router;
