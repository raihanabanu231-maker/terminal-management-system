require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  const res = await pool.query("SELECT * FROM audit_logs WHERE resource_id = 'a314501f-2c31-4a1c-97e5-27484179cba9' ORDER BY created_at DESC LIMIT 10");
  console.log("LAST 10 AUDIT LOGS FOR DEVICE:", res.rows);
  await pool.end();
}
check();
