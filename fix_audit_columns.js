require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function runFix() {
  const client = await pool.connect();
  try {
    console.log("🚀 Starting DB Column Synchronization (Audit Fix)...");
    await client.query("BEGIN");

    // 1. Tenants
    const tenantColsRes = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'tenants'");
    const tenantCols = tenantColsRes.rows.map(r => r.column_name);

    if (!tenantCols.includes('audit_logging_enabled')) {
      console.log("➕ Adding 'audit_logging_enabled' to tenants...");
      await client.query("ALTER TABLE tenants ADD COLUMN audit_logging_enabled BOOLEAN NOT NULL DEFAULT true");
    }
    if (!tenantCols.includes('logo_url')) {
      console.log("➕ Adding 'logo_url' to tenants...");
      await client.query("ALTER TABLE tenants ADD COLUMN logo_url TEXT");
    }
    if (!tenantCols.includes('primary_color')) {
      console.log("➕ Adding 'primary_color' to tenants...");
      await client.query("ALTER TABLE tenants ADD COLUMN primary_color TEXT");
    }

    // 2. Merchants
    const merchColsRes = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'merchants'");
    const merchCols = merchColsRes.rows.map(r => r.column_name);

    if (!merchCols.includes('audit_logging_enabled')) {
      console.log("➕ Adding 'audit_logging_enabled' to merchants...");
      await client.query("ALTER TABLE merchants ADD COLUMN audit_logging_enabled BOOLEAN");
    }

    // 3. Device Audit Logs
    const logColsRes = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'device_audit_logs'");
    const logCols = logColsRes.rows.map(r => r.column_name);

    if (!logCols.includes('merchant_path')) {
      console.log("➕ Adding 'merchant_path' to device_audit_logs...");
      await client.query("ALTER TABLE device_audit_logs ADD COLUMN merchant_path TEXT DEFAULT '/'");
    }

    await client.query("COMMIT");
    console.log("✅ Column synchronization successfully completed.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ ERROR during fixing columns:", err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

runFix();
