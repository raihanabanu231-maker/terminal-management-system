const crypto = require('crypto');
const tokenFromLogs = 'c10116ebc6868be12da1b7860639fe29a4b9749f6b5567eae21aca4d44ee3860';
const hash = crypto.createHash('sha256').update(tokenFromLogs).digest('hex');
console.log(`Token: ${tokenFromLogs}`);
console.log(`Hash:  ${hash}`);

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function findHash() {
    try {
        const res = await pool.query("SELECT email, status, created_at FROM user_invitations WHERE token_hash = $1", [hash]);
        if (res.rows.length > 0) {
            console.log("✅ MATCH FOUND!");
            console.log(JSON.stringify(res.rows[0], null, 2));
        } else {
            console.log("❌ NO MATCH in database for this specific hash.");

            // Check for similar hashes
            const all = await pool.query("SELECT email, token_hash FROM user_invitations ORDER BY created_at DESC LIMIT 5");
            console.log("\nRecent hashes in DB:");
            all.rows.forEach(r => console.log(`- ${r.email}: ${r.token_hash}`));
        }
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
findHash();
