require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkSuperAdminHash() {
    try {
        const res = await pool.query("SELECT password_hash FROM users WHERE email = 'superadmin@tms.com'");
        console.log(res.rows[0].password_hash);
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
checkSuperAdminHash();
