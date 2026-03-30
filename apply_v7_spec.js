const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function applyV7Spec() {
    const client = await pool.connect();
    try {
        console.log("🚀 Applying Architect Spec V7 (Hybrid Device Groups & Hierarchy)...");
        await client.query("BEGIN");

        // 1. Cleanup Device Groups (if exists) to prevent constraint issues
        await client.query("DROP TABLE IF EXISTS device_group_members CASCADE");
        await client.query("DROP TABLE IF EXISTS device_groups CASCADE");

        // 2. Create device_groups per V7 Spec (Hybrid: merchant_id optional, merchant_path NOT NULL)
        await client.query(`
            CREATE TABLE device_groups (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
                merchant_path TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                deleted_at TIMESTAMPTZ,
                UNIQUE(tenant_id, merchant_id, name)
            )
        `);

        // 3. Create device_group_members (V7 Spec: serial-only tracking via devices table)
        await client.query(`
            CREATE TABLE device_group_members (
                group_id UUID NOT NULL REFERENCES device_groups(id) ON DELETE CASCADE,
                device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (group_id, device_id)
            )
        `);

        // 4. Ensure devices table is indexed for path lookups
        await client.query("CREATE INDEX IF NOT EXISTS idx_devices_merchant_path ON devices(merchant_path)");
        await client.query("CREATE INDEX IF NOT EXISTS idx_device_groups_merchant_path ON device_groups(merchant_path)");

        await client.query("COMMIT");
        console.log("✅ Architect Spec V7 applied successfully.");

    } catch (error) {
        await client.query("ROLLBACK");
        console.error("❌ Migration failed:", error);
    } finally {
        client.release();
        await pool.end();
    }
}

applyV7Spec();
