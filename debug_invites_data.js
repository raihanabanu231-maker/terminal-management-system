require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        console.log("🔍 Checking user_invitations table definition...");
        const res = await pool.query(`
            SELECT table_name, constraint_name, constraint_type 
            FROM information_schema.table_constraints 
            WHERE table_name = 'user_invitations'
        `);
        console.log("Constraints:", JSON.stringify(res.rows, null, 2));

        console.log("\n🔍 Checking invite records for potential issues...");
        const invites = await pool.query(`
            SELECT id, email, role_id, tenant_id, token_hash, status, expires_at 
            FROM user_invitations 
            ORDER BY created_at DESC LIMIT 10
        `);
        console.table(invites.rows);

        // Check if role_id or tenant_id refers to non-existent rows
        for (const invite of invites.rows) {
            const roleCheck = await pool.query("SELECT id FROM roles WHERE id = $1", [invite.role_id]);
            const tenantCheck = await pool.query("SELECT id FROM tenants WHERE id = $1", [invite.tenant_id]);
            console.log(`Invite ${invite.id}: RoleExists=${roleCheck.rows.length > 0}, TenantExists=${tenantCheck.rows.length > 0}`);
        }

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
run();
