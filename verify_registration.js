require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function checkRegistration() {
    try {
        console.log("🔍 Checking for completed registrations...");

        // 1. Check Invitations
        const inviteRes = await pool.query(`
      SELECT email, status, tenant_id, created_at, role_id 
      FROM user_invitations 
      ORDER BY created_at DESC LIMIT 5
    `);
        console.log("\n--- Recent Invitations ---");
        console.log(JSON.stringify(inviteRes.rows, null, 2));

        // 2. Check Users
        const userRes = await pool.query(`
      SELECT id, email, first_name, last_name, status, created_at, tenant_id 
      FROM users 
      ORDER BY created_at DESC LIMIT 5
    `);
        console.log("\n--- Recent Users ---");
        console.log(JSON.stringify(userRes.rows, null, 2));

        // 3. Check User Roles for the latest user
        if (userRes.rows.length > 0) {
            const latestUserId = userRes.rows[0].id;
            const roleRes = await pool.query(`
        SELECT ur.user_id, r.name as role_name, ur.scope_type, ur.scope_id
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = $1
      `, [latestUserId]);
            console.log(`\n--- Roles for User ${userRes.rows[0].email} ---`);
            console.log(JSON.stringify(roleRes.rows, null, 2));
        }

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkRegistration();
