require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function verifyLogin() {
    const email = 'superadmin@tms.com';
    const password = 'admin123';

    try {
        const res = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (res.rows.length === 0) {
            console.log('❌ User not found');
            return;
        }

        const user = res.rows[0];
        const match = await bcrypt.compare(password, user.password_hash);
        console.log(`Email: ${email}`);
        console.log(`User Status: ${user.status}`);
        console.log(`Password Match: ${match}`);

        const roleRes = await pool.query("SELECT * FROM user_roles WHERE user_id = $1", [user.id]);
        console.log(`Assigned Roles: ${JSON.stringify(roleRes.rows, null, 2)}`);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

verifyLogin();
