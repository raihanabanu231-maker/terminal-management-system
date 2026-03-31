require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  const res = await pool.query("SELECT * FROM audit_logs WHERE user_id = '4fecc78f-56e5-4231-89ed-792262c45549' ORDER BY created_at DESC LIMIT 5");
  console.log("LAST 5 AUDIT LOGS FOR USER:", res.rows);
  await pool.end();
}
check();
