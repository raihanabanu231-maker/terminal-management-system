const express = require("express");
const router = express.Router();

const { inviteUser } = require("./user.controller");
const { verifyToken } = require("../../middleware/auth.middleware");


router.post(
  "/invite",
  verifyToken,
  inviteUser
);

module.exports = router;
