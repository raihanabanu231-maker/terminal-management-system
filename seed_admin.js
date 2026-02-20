require("dotenv").config();
const { Pool } = require("pg");
const bcrypt = require("bcrypt");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function seedAdmin() {
    const client = await pool.connect();
    try {
        console.log("🛠️ Seeding Super Admin for Production Schema...");
        await client.query("BEGIN");

        // 1. Create System Tenant
        const tenantRes = await client.query(
            "INSERT INTO tenants (name, status) VALUES ('System', 'active') ON CONFLICT DO NOTHING RETURNING id"
        );
        let tenantId;
        if (tenantRes.rows.length > 0) {
            tenantId = tenantRes.rows[0].id;
        } else {
            const existingTenant = await client.query("SELECT id FROM tenants WHERE name = 'System' LIMIT 1");
            tenantId = existingTenant.rows[0].id;
        }

        // 2. Create Super Admin Role (System Level)
        const roleRes = await client.query(
            "INSERT INTO roles (tenant_id, name, permissions) VALUES (NULL, 'Super Admin', '{*}') ON CONFLICT DO NOTHING RETURNING id"
        );
        let roleId;
        if (roleRes.rows.length > 0) {
            roleId = roleRes.rows[0].id;
        } else {
            const existingRole = await client.query("SELECT id FROM roles WHERE name = 'Super Admin' AND tenant_id IS NULL LIMIT 1");
            roleId = existingRole.rows[0].id;
        }

        // 3. Create Super Admin User
        const password = "admin";
        const hashedPassword = await bcrypt.hash(password, 10);
        const email = "superadmin@tms.com";

        const userRes = await client.query(
            `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, status)
       VALUES ($1, $2, $3, 'System', 'Admin', 'active')
       ON CONFLICT (tenant_id, email) 
       DO UPDATE SET password_hash = $3, status = 'active'
       RETURNING id`,
            [tenantId, email, hashedPassword]
        );
        const userId = userRes.rows[0].id;

        // 4. Assign Role
        await client.query(
            `INSERT INTO user_roles (user_id, role_id, scope_type, scope_id)
       VALUES ($1, $2, 'tenant', $3)
       ON CONFLICT DO NOTHING`,
            [userId, roleId, tenantId]
        );

        await client.query("COMMIT");
        console.log("✅ Super Admin Seeded Successfully");
        console.log(`User ID: ${userId}`);
        console.log(`Email: ${email}`);

    } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ Error seeding admin:", err);
    } finally {
        client.release();
        pool.end();
    }
}

seedAdmin();
