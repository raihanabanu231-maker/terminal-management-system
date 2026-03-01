require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function resetSuperAdmin() {
    const email = 'superadmin@tms.com';
    const password = 'Password123!';
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query("UPDATE users SET password_hash = $1, failed_attempts = 0, status = 'active' WHERE email = $2", [hashedPassword, email]);
        console.log(`✅ Superadmin [${email}] reset successfully to: ${password}`);
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
resetSuperAdmin();
