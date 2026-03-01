require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkSuperAdmin() {
    try {
        const res = await pool.query("SELECT email, status, locked_until, failed_attempts FROM users WHERE email = 'superadmin@tms.com'");
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
checkSuperAdmin();
