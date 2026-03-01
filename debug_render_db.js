require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function debugProduction() {
    try {
        console.log("🔍 Checking Production DB Schema for user_invitations...");
        const cols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'user_invitations'");
        console.table(cols.rows);

        console.log("\n🔍 Checking for ANY pending invitations...");
        const invites = await pool.query("SELECT id, email, token_hash, status, created_at FROM user_invitations ORDER BY created_at DESC LIMIT 5");
        console.table(invites.rows);

        if (invites.rows.length > 0) {
            const hash = invites.rows[0].token_hash;
            console.log(`\n🔍 Testing query logic with hash: ${hash}`);
            const testJoin = await pool.query(`
                SELECT ui.id, r.name as role_name, t.name as company_name
                FROM user_invitations ui
                LEFT JOIN roles r ON ui.role_id = r.id
                LEFT JOIN tenants t ON ui.tenant_id = t.id
                WHERE ui.token_hash = $1
            `, [hash]);
            console.log("Join Result:", testJoin.rows);
        }

    } catch (err) {
        console.error("❌ Debug Script Failed:", err);
    } finally {
        await pool.end();
    }
}

debugProduction();
