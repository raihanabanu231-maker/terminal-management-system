require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function finalReset() {
  const res = await pool.query("UPDATE commands SET status = 'queued', acked_at = NULL, sent_at = NULL");
  console.log(`✅ SUCCESS: ${res.rowCount} commands reset to 'queued'.`);
  const check = await pool.query("SELECT status, count(*) FROM commands GROUP BY status");
  console.log("Status Counts:", check.rows);
  await pool.end();
}
finalReset();
