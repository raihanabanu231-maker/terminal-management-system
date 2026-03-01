require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    const email = 'superadmin@tms.com';
    try {
        const res = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        console.log("--- BEFORE RESET ---");
        console.log(JSON.stringify(res.rows, null, 2));

        const newPass = 'Password123!';
        const hash = await bcrypt.hash(newPass, 10);
        await pool.query("UPDATE users SET password_hash = $1, failed_attempts = 0, locked_until = NULL, status = 'active' WHERE email = $2", [hash, email]);

        const after = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        console.log("\n--- AFTER RESET ---");
        console.log(JSON.stringify(after.rows, null, 2));
        console.log(`\n✅ RESET COMPLETE. Email: ${email}, Password: ${newPass}`);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
run();
