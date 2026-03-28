const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function applyArchitectSpec() {
    const client = await pool.connect();
    try {
        console.log("🚀 Applying Architect Spec V7 (Device Groups & Hierarchy)...");
        await client.query("BEGIN");

        // 1. Devices: Add merchant_path
        await client.query("ALTER TABLE devices ADD COLUMN IF NOT EXISTS merchant_path TEXT");

        // 2. Drop existing to ensure fresh spec compliance for groups
        await client.query("DROP TABLE IF EXISTS device_group_members CASCADE");
        await client.query("DROP TABLE IF EXISTS device_groups CASCADE");

        // 3. Create device_groups per V7 Spec
        await client.query(`
            CREATE TABLE device_groups (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
                merchant_path TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                deleted_at TIMESTAMPTZ,
                UNIQUE (tenant_id, merchant_id, name)
            )
        `);

        // 4. Create device_group_members
        await client.query(`
            CREATE TABLE device_group_members (
                group_id UUID NOT NULL REFERENCES device_groups(id) ON DELETE CASCADE,
                device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
                PRIMARY KEY (group_id, device_id)
            )
        `);

        // 5. Create Indexes
        await client.query("CREATE INDEX IF NOT EXISTS idx_groups_merchant_path ON device_groups(merchant_path)");
        await client.query("CREATE INDEX IF NOT EXISTS idx_devices_merchant_path ON devices(merchant_path)");

        await client.query("COMMIT");
        console.log("✅ Architect Spec V7 applied successfully.");
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("❌ Error applying spec:", error);
    } finally {
        client.release();
        await pool.end();
    }
}

applyArchitectSpec();
