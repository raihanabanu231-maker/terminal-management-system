require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkSuperAdminDetail() {
    try {
        const res = await pool.query(`
            SELECT u.email, u.status, u.failed_attempts, u.locked_until, u.password_hash, t.status as tenant_status
            FROM users u
            LEFT JOIN tenants t ON u.tenant_id = t.id
            WHERE u.email = 'superadmin@tms.com'
        `);
        console.log("🔍 SuperAdmin Details:");
        console.log(JSON.stringify(res.rows, null, 2));

        const audit = await pool.query(`
            SELECT * FROM audit_logs 
            WHERE user_id = (SELECT id FROM users WHERE email = 'superadmin@tms.com')
            ORDER BY created_at DESC LIMIT 5
        `);
        console.log("\n🔍 Recent Audit Logs:");
        console.log(JSON.stringify(audit.rows, null, 2));

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
checkSuperAdminDetail();
