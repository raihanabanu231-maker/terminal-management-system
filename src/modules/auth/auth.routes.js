const express = require("express");
const router = express.Router();

const { login, registerWithInvite } = require("./auth.controller");

// 🔐 Login route
router.post("/login", login);

// 📨 Register via invite route
router.post("/register", registerWithInvite);

module.exports = router;
