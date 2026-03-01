require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkTenants() {
    try {
        const res = await pool.query("SELECT id, name FROM tenants ORDER BY created_at DESC LIMIT 5");
        console.log("Recent Tenants:", res.rows);

        const inviteRes = await pool.query(`
            SELECT ui.email, ui.tenant_id, t.name as company_name 
            FROM user_invitations ui 
            LEFT JOIN tenants t ON ui.tenant_id = t.id 
            ORDER BY ui.created_at DESC LIMIT 5
        `);
        console.log("\nRecent Invites:", inviteRes.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
checkTenants();
