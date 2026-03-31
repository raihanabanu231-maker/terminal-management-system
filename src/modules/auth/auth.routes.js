const express = require("express");
const router = express.Router();

const { login, registerWithInvite, getInviteDetails, refresh, logout, ping } = require("./auth.controller");

// 🔐 Login route
router.post("/login", login);

// 🏓 Ping route (Diagnostic)
router.get("/ping", ping);

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

// ⚡ EMAIL DIAGNOSTIC ROUTE
router.get("/diag/email", async (req, res) => {
    try {
        const { sendInviteEmail } = require("../../utils/email");
        await sendInviteEmail("test@example.com", "https://example.com", {
            roleName: "DIAG_ROLE",
            companyName: "DIAG_ORG"
        });
        res.json({ 
            success: true, 
            message: "Email service REST API is functioning correctly.",
            sender: process.env.SENDER_EMAIL 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: "Brevo service error", 
            details: error.message 
        });
    }
});

module.exports = router;
