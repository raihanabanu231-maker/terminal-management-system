require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function verifyToken(rawToken) {
    try {
        const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
        console.log(`🔍 Testing Token: [${rawToken}]`);
        console.log(`🔍 Generated Hash: [${hash}]`);

        const res = await pool.query("SELECT email, status FROM user_invitations WHERE token_hash = $1", [hash]);
        if (res.rows.length > 0) {
            console.log("✅ MATCH FOUND!");
            console.log(JSON.stringify(res.rows[0], null, 2));
        } else {
            console.log("❌ NO MATCH in database.");
        }
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

// Check with the token value if provided by user
verifyToken('c10116ebc6868be12da1b7860639fe29a4b9749f6b5567eae21aca4d44ee3860');
