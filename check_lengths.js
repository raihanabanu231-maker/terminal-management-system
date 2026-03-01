require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkLengths() {
    try {
        console.log("🔍 Checking EXACT lengths of token_hash in DB...");
        const res = await pool.query("SELECT email, LENGTH(token_hash) as len, token_hash FROM user_invitations ORDER BY created_at DESC LIMIT 5");
        res.rows.forEach(row => {
            console.log(`Email: ${row.email} | Length: ${row.len} | Hash: [${row.token_hash}]`);
        });
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
checkLengths();
