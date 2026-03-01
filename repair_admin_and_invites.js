require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function repair() {
    try {
        console.log('--- REPAIR START ---');

        // 1. Restore Super Admin Role
        const adminRes = await pool.query("SELECT id FROM users WHERE email = 'superadmin@tms.com'");
        const roleRes = await pool.query("SELECT id FROM roles WHERE name = 'Super Admin' AND tenant_id IS NULL");

        if (adminRes.rows.length > 0 && roleRes.rows.length > 0) {
            const adminId = adminRes.rows[0].id;
            const roleId = roleRes.rows[0].id;

            await pool.query(
                "INSERT INTO user_roles (user_id, role_id, scope_type, scope_id) VALUES ($1, $2, 'tenant', '00000000-0000-0000-0000-000000000000') ON CONFLICT DO NOTHING",
                [adminId, roleId]
            );
            console.log('✅ Super Admin role assignment restored.');
        } else {
            console.log('⚠️ Could not find Super Admin user or role.');
        }

        // 2. Identify Broken Invitations
        // An invitation is "broken" if its role_id or tenant_id no longer exists
        const invites = await pool.query("SELECT id, email, role_id, tenant_id FROM user_invitations");
        console.log(`Checking ${invites.rows.length} invitations...`);

        for (const invite of invites.rows) {
            const roleCheck = await pool.query("SELECT id FROM roles WHERE id = $1", [invite.role_id]);
            if (roleCheck.rows.length === 0) {
                console.log(`❌ Invitation for ${invite.email} points to missing role ${invite.role_id}. LINK WILL BE INVALID.`);
            }

            if (invite.tenant_id) {
                const tenantCheck = await pool.query("SELECT id FROM tenants WHERE id = $1", [invite.tenant_id]);
                if (tenantCheck.rows.length === 0) {
                    console.log(`❌ Invitation for ${invite.email} points to missing tenant ${invite.tenant_id}. LINK WILL BE INVALID.`);
                }
            }
        }

        console.log('--- REPAIR END ---');
    } catch (err) {
        console.error('Repair Error:', err);
    } finally {
        await pool.end();
    }
}

repair();
