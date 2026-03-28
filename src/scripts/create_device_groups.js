const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function createDeviceGroups() {
    const client = await pool.connect();
    try {
        console.log("🚀 Creating Device Group Schema...");
        await client.query("BEGIN");

        // 1. Device Groups
        await client.query(`
            CREATE TABLE IF NOT EXISTS device_groups (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
                name TEXT NOT NULL,
                description TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                deleted_at TIMESTAMPTZ
            );
        `);

        // 2. Device Group Members
        await client.query(`
            CREATE TABLE IF NOT EXISTS device_group_members (
                group_id UUID NOT NULL REFERENCES device_groups(id) ON DELETE CASCADE,
                device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
                PRIMARY KEY (group_id, device_id)
            );
        `);

        // 3. Performance Indexes
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_device_groups_tenant_id ON device_groups(tenant_id);
            CREATE INDEX IF NOT EXISTS idx_device_groups_merchant_id ON device_groups(merchant_id);
            CREATE INDEX IF NOT EXISTS idx_device_group_members_device_id ON device_group_members(device_id);
        `);

        await client.query("COMMIT");
        console.log("✅ Device Group Schema Created Successfully.");

    } catch (error) {
        await client.query("ROLLBACK");
        console.error("❌ Error Creating Schema:", error);
    } finally {
        client.release();
        await pool.end();
    }
}

createDeviceGroups();
