require("dotenv").config();
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function testLogin() {
    const email = "superadmin@tms.com";
    const password = "admin123";

    try {
        const res = await pool.query(
            `SELECT u.*, t.status as tenant_status 
       FROM users u 
       LEFT JOIN tenants t ON u.tenant_id = t.id 
       WHERE u.email = $1 AND u.deleted_at IS NULL`,
            [email]
        );

        if (res.rows.length === 0) {
            console.log("❌ User not found");
            return;
        }

        const user = res.rows[0];
        console.log("✅ User found in DB:", user.email, "Tenant ID:", user.tenant_id);

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            console.log("❌ Password mismatch");
        } else {
            console.log("✅ Password matches!");
        }

        const rolesRes = await pool.query(
            `SELECT r.name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = $1`,
            [user.id]
        );
        console.log("Roles found:", rolesRes.rows.map(r => r.name));

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

testLogin();
