require("dotenv").config();
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function fixAdmin() {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        console.log("🧹 Cleaning up duplicate superadmin users...");
        await client.query("DELETE FROM users WHERE email = 'superadmin@tms.com'");

        const password = "admin123";
        const hashedPassword = await bcrypt.hash(password, 10);
        const email = "superadmin@tms.com";

        console.log("🛠️ Inserting Single Global Super Admin (tenant_id = NULL)...");
        const userRes = await client.query(
            `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, status)
       VALUES (NULL, $1, $2, 'System', 'Admin', 'active')
       RETURNING id`,
            [email, hashedPassword]
        );
        const userId = userRes.rows[0].id;

        console.log("🔑 Re-linking Super Admin Role (NULL tenant scope)...");

        // Check if role exists
        const roleRes = await client.query("SELECT id FROM roles WHERE name = 'Super Admin' AND tenant_id IS NULL LIMIT 1");
        let roleId;
        if (roleRes.rows.length > 0) {
            roleId = roleRes.rows[0].id;
        } else {
            // Create role if missing
            const newRole = await client.query("INSERT INTO roles (tenant_id, name, permissions) VALUES (NULL, 'Super Admin', '{*}') RETURNING id");
            roleId = newRole.rows[0].id;
        }

        // delete old roles for this user just in case
        await client.query("DELETE FROM user_roles WHERE user_id = $1", [userId]);

        await client.query(
            `INSERT INTO user_roles (user_id, role_id, scope_type, scope_id)
       VALUES ($1, $2, 'tenant', NULL)`,
            [userId, roleId]
        );

        await client.query("COMMIT");
        console.log("✅ DONE: Super Admin fixed. Email: superadmin@tms.com / Password: admin123");
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ Error:", err);
    } finally {
        client.release();
        pool.end();
    }
}

fixAdmin();
