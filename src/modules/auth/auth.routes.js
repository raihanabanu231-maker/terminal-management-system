const express = require("express");
const router = express.Router();

const { login, registerWithInvite, getInviteDetails } = require("./auth.controller");

// 🔐 Login route
router.post("/login", login);

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
