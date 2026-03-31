require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  const tCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'tenants'");
  console.log("TENANTS:", tCols.rows.map(r => r.column_name));
  
  const mCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'merchants'");
  console.log("MERCHANTS:", mCols.rows.map(r => r.column_name));
  
  const lCols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'device_audit_logs'");
  console.log("LOGS:", lCols.rows.map(r => r.column_name));
  
  await pool.end();
}
check();
