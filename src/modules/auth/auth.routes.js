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

router.get(\"/diag/email\", async (req, res) \u003d\u003e {\n    try {\n        const { sendInviteEmail } \u003d require(\"../../utils/email\");\n        await sendInviteEmail(\"test@example.com\", \"https://example.com\", {\n            roleName: \"DIAG_ROLE\",\n            companyName: \"DIAG_ORG\"\n        });\n        res.json({ success: true, message: \"Service is online and working\" });\n    } catch (error) {\n        res.status(500).json({ success: false, message: \"Brevo error caught\", details: error.message });\n    }\n});\n\nmodule.exports \u003d router;
