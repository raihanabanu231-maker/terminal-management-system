require("dotenv").config();
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function seedOperator() {
    const client = await pool.connect();
    try {
        console.log("🛠️ Seeding Operator for Testing...");
        await client.query("BEGIN");

        // 1. Ensure Tenant exists
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

        // 2. Ensure Merchant exists
        const merchantRes = await client.query(
            "INSERT INTO merchants (tenant_id, name, path) VALUES ($1, 'Main Store', '') ON CONFLICT DO NOTHING RETURNING id",
            [tenantId]
        );
        let merchantId;
        if (merchantRes.rows.length > 0) {
            merchantId = merchantRes.rows[0].id;
        } else {
            const existingMerchant = await client.query("SELECT id FROM merchants WHERE name = 'Main Store' AND tenant_id = $1 LIMIT 1", [tenantId]);
            merchantId = existingMerchant.rows[0].id;
        }

        // 3. Get the Operator Role ID
        const roleRes = await client.query(
            "SELECT id FROM roles WHERE name = 'Operator' AND tenant_id IS NULL LIMIT 1"
        );
        if (roleRes.rows.length === 0) {
            throw new Error("Operator role not found.");
        }
        const roleId = roleRes.rows[0].id;

        // 4. Create Operator User
        const password = "admin123";
        const hashedPassword = await bcrypt.hash(password, 10);
        const email = "operator@alpha.com";

        const userRes = await client.query(
            `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name, status, invited)
             VALUES ($1, $2, $3, 'Test', 'Operator', 'active', false)
             ON CONFLICT (tenant_id, email) 
             DO UPDATE SET password_hash = $3, status = 'active'
             RETURNING id`,
            [tenantId, email, hashedPassword]
        );
        const userId = userRes.rows[0].id;

        // 5. Assign Role scoped to the Merchant
        await client.query(
            `INSERT INTO user_roles (user_id, role_id, scope_type, scope_id)
             VALUES ($1, $2, 'merchant', $3)
             ON CONFLICT DO NOTHING`,
            [userId, roleId, merchantId]
        );

        await client.query("COMMIT");
        console.log("✅ Operator Seeded Successfully");
        console.log(`Email: ${email}`);
        console.log(`Password: ${password}`);
        console.log(`Scoped to Merchant: Main Store (ID: ${merchantId})`);

    } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ Error seeding operator:", err);
    } finally {
        client.release();
        pool.end();
    }
}

seedOperator();
