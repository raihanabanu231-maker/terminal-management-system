require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function findPartialMatch() {
    try {
        console.log("🔍 Searching for ANY invitation that might be related...");

        // Let's check the last 20 invitations
        const res = await pool.query("SELECT email, token_hash, created_at FROM user_invitations ORDER BY created_at DESC LIMIT 20");

        console.log("Looking for related hashes or emails...");
        const targetTokenPrefix = "c10116";

        res.rows.forEach(row => {
            if (row.email.toLowerCase().includes("raihana") || row.email.toLowerCase().includes("mohamed")) {
                console.log(`Email: ${row.email}`);
                console.log(`Full Hash: ${row.token_hash}`);
                console.log(`Created: ${row.created_at}`);
                console.log('---');
            }
        });

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

findPartialMatch();
