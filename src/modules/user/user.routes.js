const express = require("express");
const router = express.Router();

const { inviteUser, getInvitations, deleteInvitation } = require("./user.controller");
const { verifyToken } = require("../../middleware/auth.middleware");
const { authorizeRoles } = require("../../middleware/role.middleware");


router.post(
  "/invite",
  verifyToken,
  authorizeRoles("SUPER_ADMIN"),
  inviteUser
);

router.get(
  "/invites",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN"),
  getInvitations
);

router.delete(
  "/invites/:id",
  verifyToken,
  authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN"),
  deleteInvitation
);

module.exports = router;
