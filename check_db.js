require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function check() {
  try {
    const tRes = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'tenants'");
    console.log("TENANT_COLS:", JSON.stringify(tRes.rows.map(r => r.column_name)));

    const mRes = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'merchants'");
    console.log("MERCHANT_COLS:", JSON.stringify(mRes.rows.map(r => r.column_name)));

    const aRes = await pool.query("SELECT count(*) FROM device_audit_logs");
    console.log("AUDIT_COUNT:", aRes.rows[0].count);

  } catch (err) {
    console.error("DEBUG_ERROR:", err.message);
  } finally {
    await pool.end();
  }
}

check();
