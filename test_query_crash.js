require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function testGetInviteDetails() {
    const tokenHash = 'any_dummy_hash_or_real_if_you_have_one';
    try {
        console.log("🔍 Testing getInviteDetails query...");
        const result = await pool.query(
            `SELECT ui.*, r.name as role_name, t.name as company_name
           FROM user_invitations ui
           LEFT JOIN roles r ON ui.role_id = r.id
           LEFT JOIN tenants t ON ui.tenant_id = t.id
           WHERE ui.token_hash = $1`,
            [tokenHash]
        );
        console.log("✅ Query successful. Rows found:", result.rows.length);
    } catch (err) {
        console.error("❌ Query FAILED:", err.message);
        console.error("Error Detail:", err.detail);
        console.error("Error Hint:", err.hint);
    } finally {
        await pool.end();
    }
}

testGetInviteDetails();
