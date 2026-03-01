require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function audit() {
    try {
        console.log('--- AUDIT START ---');

        // 1. Check Super Admin User
        const users = await pool.query("SELECT id, email, status, tenant_id FROM users WHERE email = 'superadmin@tms.com'");
        console.log('Admin User:', JSON.stringify(users.rows, null, 2));

        if (users.rows.length > 0) {
            const adminId = users.rows[0].id;

            // 2. Check Role Assignments
            const userRoles = await pool.query("SELECT * FROM user_roles WHERE user_id = $1", [adminId]);
            console.log('Admin User Roles:', JSON.stringify(userRoles.rows, null, 2));

            // 3. Check Role Definitions for those IDs
            if (userRoles.rows.length > 0) {
                const roleIds = userRoles.rows.map(r => r.role_id);
                const roles = await pool.query("SELECT * FROM roles WHERE id = ANY($1)", [roleIds]);
                console.log('Role Definitions:', JSON.stringify(roles.rows, null, 2));
            } else {
                console.log('⚠️ No roles assigned to Super Admin!');
            }
        } else {
            console.log('❌ Super Admin user NOT FOUND!');
        }

        // 4. Check all roles to see if they still exist
        const allRoles = await pool.query("SELECT * FROM roles");
        console.log('Total Roles in System:', allRoles.rows.length);
        console.log('All Roles:', JSON.stringify(allRoles.rows, null, 2));

        // 5. Check Invitations
        const invites = await pool.query("SELECT email, status, expires_at FROM user_invitations LIMIT 5");
        console.log('Recent Invitations:', JSON.stringify(invites.rows, null, 2));

        console.log('--- AUDIT END ---');
    } catch (err) {
        console.error('Audit Error:', err);
    } finally {
        await pool.end();
    }
}

audit();
