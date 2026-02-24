
const pool = require("./src/config/db");
const crypto = require("crypto");
require("dotenv").config();

async function checkToken() {
    const rawToken = "270e6a1ab6b482387be4aab24caf954ec8f5378385cacff3fd274613bec82335";
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    console.log("🔍 Checking Token Hash:", tokenHash);

    try {
        const result = await pool.query(
            "SELECT id, email, status, expires_at FROM user_invitations WHERE token_hash = $1",
            [tokenHash]
        );

        if (result.rows.length === 0) {
            console.log("❌ NOT FOUND: This token does not exist in the database.");
        } else {
            const invite = result.rows[0];
            console.log("✅ FOUND:");
            console.log(`   Email: ${invite.email}`);
            console.log(`   Status: ${invite.status}`);
            console.log(`   Expires At: ${invite.expires_at}`);

            const now = new Date();
            if (invite.status !== 'pending') {
                console.log("⚠️ PROBLEM: This invitation has already been ACCEPTED or cancelled.");
            } else if (invite.expires_at < now) {
                console.log("⚠️ PROBLEM: This invitation has EXPIRED.");
            } else {
                console.log("🚀 STATUS: This token is valid and ready to use!");
            }
        }
    } catch (err) {
        console.error("❌ DB ERROR:", err.message);
    } finally {
        await pool.end();
    }
}

checkToken();
