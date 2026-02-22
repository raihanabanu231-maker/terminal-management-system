require("dotenv").config();
const { Pool } = require("pg");
const bcrypt = require("bcrypt");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function seedTenantAdmin() {
    const client = await pool.connect();
    try {
        console.log("🛠️ Seeding Tenant Admin for Testing...");
        await client.query("BEGIN");

        // 1. Create a Test Tenant
        const tenantRes = await client.query(
            "INSERT INTO tenants (name, status) VALUES ('Alpha Corp', 'active') ON CONFLICT DO NOTHING RETURNING id"
        );
        let tenantId;
        if (tenantRes.rows.length > 0) {
            tenantId = tenantRes.rows[0].id;
        } else {
            const existingTenant = await client.query("SELECT id FROM tenants WHERE name = 'Alpha Corp' LIMIT 1");
            tenantId = existingTenant.rows[0].id;
        }

        // 2. Get the Tenant Admin Role ID
        const roleRes = await client.query(
            "SELECT id FROM roles WHERE name = 'Tenant Admin' AND tenant_id IS NULL LIMIT 1"
        );
        if (roleRes.rows.length === 0) {
            throw new Error("Tenant Admin role not found. Please run init_db.js first.");
        }
        const roleId = roleRes.rows[0].id;

        // 3. Create Tenant Admin User
        const password = "admin123";
        const hashedPassword = await bcrypt.hash(password, 10);
        const email = "admin@alpha.com";

        const userRes = await client.query(
            `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, status, invited)
             VALUES ($1, $2, $3, 'Alpha', 'Admin', 'active', false)
             ON CONFLICT (tenant_id, email) 
             DO UPDATE SET password_hash = $3, status = 'active'
             RETURNING id`,
            [tenantId, email, hashedPassword]
        );
        const userId = userRes.rows[0].id;

        // 4. Assign Role scoped to this Tenant
        await client.query(
            `INSERT INTO user_roles (user_id, role_id, scope_type, scope_id)
             VALUES ($1, $2, 'tenant', $3)
             ON CONFLICT DO NOTHING`,
            [userId, roleId, tenantId]
        );

        await client.query("COMMIT");
        console.log("✅ Tenant Admin Seeded Successfully");
        console.log(`Tenant: Alpha Corp (ID: ${tenantId})`);
        console.log(`Email: ${email}`);
        console.log(`Password: ${password}`);

    } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ Error seeding tenant admin:", err);
    } finally {
        client.release();
        pool.end();
    }
}

seedTenantAdmin();
