
require("dotenv").config();
const { Pool } = require("pg");
const crypto = require("crypto");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function findToken() {
    const rawToken = "270e6a1ab6b482387be4aab24caf954ec8f5378385cacff3fd274613bec82335";
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    try {
        const r = await pool.query("SELECT email, status, token_hash FROM user_invitations WHERE token_hash = $1", [tokenHash]);
        if (r.rows.length > 0) {
            console.log("MATCH_FOUND:", JSON.stringify(r.rows[0]));
        } else {
            console.log("NO_MATCH_FOUND for hash:", tokenHash);
            const all = await pool.query("SELECT email, status, token_hash FROM user_invitations ORDER BY created_at DESC LIMIT 5");
            console.log("LATEST_INVITES:", JSON.stringify(all.rows, null, 2));
        }
    } finally {
        await pool.end();
    }
}
findToken();
