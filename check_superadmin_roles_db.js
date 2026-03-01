require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkSuperadminRoles() {
    try {
        const userRes = await pool.query("SELECT id, email, tenant_id FROM users WHERE email = 'superadmin@tms.com'");
        if (userRes.rows.length === 0) {
            console.log("Superadmin user not found");
            return;
        }
        const user = userRes.rows[0];
        console.log("User Row:", user);

        const rolesRes = await pool.query(`
            SELECT r.name as role_name, ur.scope_type, ur.scope_id
            FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = $1
        `, [user.id]);

        console.log("Assigned Roles:", rolesRes.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
checkSuperadminRoles();
