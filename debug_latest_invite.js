require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkLatestInvite() {
    try {
        console.log("🔍 Checking Latest invitation in Production...");
        const res = await pool.query(`
            SELECT id, email, token_hash, status, expires_at, created_at 
            FROM user_invitations 
            ORDER BY created_at DESC 
            LIMIT 1
        `);

        if (res.rows.length > 0) {
            console.log("Latest Invite:", JSON.stringify(res.rows[0], null, 2));
            const now = new Date();
            const expires = new Date(res.rows[0].expires_at);
            console.log(`Current Time: ${now.toISOString()}`);
            console.log(`Status: ${res.rows[0].status}`);
            console.log(`Is Expired: ${now > expires}`);
        } else {
            console.log("❌ No invitations found in database.");
        }

    } catch (err) {
        console.error("❌ Database query failed:", err);
    } finally {
        await pool.end();
    }
}

checkLatestInvite();
