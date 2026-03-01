require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function findLatest() {
    try {
        const res = await pool.query("SELECT id, email, token_hash, status, created_at FROM user_invitations ORDER BY created_at DESC LIMIT 10");
        const fs = require('fs');
        fs.writeFileSync('latest_invites.json', JSON.stringify(res.rows, null, 2));
        console.log("Written to latest_invites.json");
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
findLatest();
