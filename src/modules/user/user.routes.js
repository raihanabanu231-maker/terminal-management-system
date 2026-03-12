const express = require("express");
const router = express.Router();

const { inviteUser, getInvitations, deleteInvitation, getUsers, updateUser, deleteUser } = require("./user.controller");
const { verifyToken } = require("../../middleware/auth.middleware");
const { authorizeRoles } = require("../../middleware/role.middleware");


router.post(
  "/invite",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN"),
  inviteUser
);

// Get Registered Users
router.get(
  "/",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN", "OPERATOR", "VIEWER"),
  getUsers
);

// Update User
router.put(
  "/:id",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN"),
  updateUser
);

// Delete User
router.delete(
  "/:id",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN"),
  deleteUser
);

router.get(
  "/invites",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN", "OPERATOR", "VIEWER"),
  getInvitations
);

router.delete(
  "/invites/:id",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN"),
  deleteInvitation
);

module.exports = router;
