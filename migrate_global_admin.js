require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log("🚀 Starting Global Admin Migration...");
        await client.query("BEGIN");

        // 1. Remove NOT NULL from users.tenant_id
        console.log("🛠️ Dropping NOT NULL from users.tenant_id...");
        await client.query("ALTER TABLE users ALTER COLUMN tenant_id DROP NOT NULL;");

        // 2. Remove NOT NULL from audit_logs.tenant_id
        console.log("🛠️ Dropping NOT NULL from audit_logs.tenant_id...");
        await client.query("ALTER TABLE audit_logs ALTER COLUMN tenant_id DROP NOT NULL;");

        // 3. Update the Super Admin if it exists
        console.log("🛠️ Moving Super Admin to Global level (NULL tenant)...");
        await client.query(`
      UPDATE users 
      SET tenant_id = NULL 
      WHERE email = 'superadmin@tms.com'
    `);

        await client.query("COMMIT");
        console.log("✅ Database Migration Successful!");
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ Migration Failed:", err);
    } finally {
        client.release();
        pool.end();
    }
}

migrate();
