require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function verifySpecificToken() {
    const token = '400f59921b8be9993a0802be02d11302d13e64038093c967eef60d13c2becdfa';
    const hash = crypto.createHash('sha256').update(token).digest('hex');

    try {
        console.log(`Searching for Token Hash: ${hash}`);
        const res = await pool.query('SELECT email, status, created_at, expires_at FROM user_invitations WHERE token_hash = $1', [hash]);

        if (res.rows.length > 0) {
            console.log("✅ MATCH FOUND!");
            console.log(JSON.stringify(res.rows[0], null, 2));
        } else {
            console.log("❌ NO MATCH FOUND for this token hash.");

            const latest = await pool.query('SELECT email, token_hash, status, created_at FROM user_invitations ORDER BY created_at DESC LIMIT 3');
            console.log("\nLatest 3 invites in DB:");
            console.log(JSON.stringify(latest.rows, null, 2));
        }
    } catch (err) {
        console.error("VERIFY ERROR:", err);
    } finally {
        await pool.end();
    }
}

verifySpecificToken();
