require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function checkUser() {
    try {
        const res = await pool.query("SELECT id, email, tenant_id, password_hash, status, deleted_at FROM users WHERE email = 'superadmin@tms.com'");
        console.log("Users found:", JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

checkUser();
