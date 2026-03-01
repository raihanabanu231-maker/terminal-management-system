require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function finalCheck() {
    try {
        const uCount = await pool.query("SELECT COUNT(*) FROM users");
        console.log("Total Users in DB:", uCount.rows[0].count);

        const recentRegs = await pool.query("SELECT email, status, created_at FROM users ORDER BY created_at DESC LIMIT 3");
        console.log("Recent Users:", JSON.stringify(recentRegs.rows, null, 2));

        const recentInvites = await pool.query("SELECT email, status, created_at FROM user_invitations ORDER BY created_at DESC LIMIT 3");
        console.log("Recent Invites:", JSON.stringify(recentInvites.rows, null, 2));

    } catch (err) {
        console.error("Final Check Failed:", err);
    } finally {
        await pool.end();
    }
}

finalCheck();
