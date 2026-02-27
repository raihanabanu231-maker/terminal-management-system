
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function addConstraint() {
    const client = await pool.connect();
    try {
        console.log("🛠️ Adding unique constraint to roles table...");

        // Check if constraint exists already
        const checkRes = await client.query(`
      SELECT conname FROM pg_constraint WHERE conname = 'unique_role_name_per_tenant'
    `);

        if (checkRes.rows.length > 0) {
            console.log("✅ Constraint already exists.");
            return;
        }

        await client.query("BEGIN");

        // 1. Double check for any duplicates that might have snuck in (using a compatible syntax)
        await client.query(`
      DELETE FROM roles a USING roles b
      WHERE a.id > b.id 
      AND a.name = b.name 
      AND (a.tenant_id = b.tenant_id OR (a.tenant_id IS NULL AND b.tenant_id IS NULL));
    `);

        // 2. Add Unique Index that handles NULL tenant_id (Global roles vs Tenant roles)
        // For Global Roles (Super Admin etc where tenant_id is NULL)
        await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_global_unique 
      ON roles (name) 
      WHERE tenant_id IS NULL;
    `);

        // For Tenant Roles
        await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_tenant_unique 
      ON roles (tenant_id, name) 
      WHERE tenant_id IS NOT NULL;
    `);

        await client.query("COMMIT");
        console.log("✅ Unique constraints applied successfully.");

    } catch (err) {
        if (client) await client.query("ROLLBACK");
        console.error("❌ Failed to add constraint:", err);
    } finally {
        client.release();
        await pool.end();
    }
}

addConstraint();
