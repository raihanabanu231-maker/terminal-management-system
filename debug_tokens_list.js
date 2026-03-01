require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkTokens() {
    try {
        console.log("🔍 Checking Recent Invitations for Token Matching...");
        const res = await pool.query(`
            SELECT id, email, token_hash, created_at 
            FROM user_invitations 
            ORDER BY created_at DESC 
            LIMIT 5
        `);

        if (res.rows.length === 0) {
            console.log("❌ No invitations found.");
            return;
        }

        console.table(res.rows.map(row => ({
            id: row.id.substring(0, 8) + '...',
            email: row.email,
            hash_prefix: row.token_hash.substring(0, 10) + '...',
            created: row.created_at
        })));

    } catch (err) {
        console.error("❌ Debug Script Failed:", err);
    } finally {
        await pool.end();
    }
}

checkTokens();
