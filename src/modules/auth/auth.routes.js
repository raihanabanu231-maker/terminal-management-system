const express = require("express");
const router = express.Router();

const { login, registerWithInvite, getInviteDetails } = require("./auth.controller");

// 🔐 Login route
router.post("/login", login);

// 📨 Register via invite route
router.post("/register-invite", registerWithInvite);

// 🔍 Validate invite and get info (For pre-filling frontend form)
router.get("/invite/:token", getInviteDetails);

module.exports = router;
