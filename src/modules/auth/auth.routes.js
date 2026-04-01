const express = require("express");
const router = express.Router();

const { login, registerWithInvite, getInviteDetails, refresh, logout, ping, forgotPassword, resetPassword } = require("./auth.controller");

// 🔐 Login route
router.post("/login", login);

// 🏓 Ping route (Diagnostic)
router.get("/ping", ping);

// 🔑 Forgot & Reset Password
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

// 🔄 Refresh Token route
router.post("/refresh", refresh);

// 🚪 Logout route
router.post("/logout", logout);

// 📨 Register via invite route
router.post("/register-invite", registerWithInvite);

// 🔍 Validate invite and get info (For pre-filling frontend form)
router.get("/invite", getInviteDetails);
router.post("/invite", getInviteDetails);

// 🧪 Debug Hashing (Temporary)
router.post("/test-token", (req, res) => {
    const { token } = req.body;
    const crypto = require("crypto");
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    res.json({ token, hash });
});

module.exports = router;
