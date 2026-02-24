
require("dotenv").config();
const { Pool } = require("pg");
const crypto = require("crypto");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkToken() {
    const rawToken = "270e6a1ab6b482387be4aab24caf954ec8f5378385cacff3fd274613bec82335";
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    console.log("🔍 Database: NEON CLOUD");
    console.log("🔍 Checking Hash:", tokenHash);

    try {
        const result = await pool.query(
            "SELECT id, email, status, expires_at FROM user_invitations WHERE token_hash = $1",
            [tokenHash]
        );

        if (result.rows.length === 0) {
            console.log("❌ NOT FOUND: Token does not exist.");
        } else {
            const invite = result.rows[0];
            console.log("✅ FOUND:");
            console.log(`   Email: ${invite.email}`);
            console.log(`   Status: ${invite.status}`);
            console.log(`   Expires At: ${invite.expires_at}`);
        }
    } catch (err) {
        console.error("❌ ERROR:", err.message);
    } finally {
        await pool.end();
    }
}

checkToken();
