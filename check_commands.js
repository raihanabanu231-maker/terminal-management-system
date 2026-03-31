require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  const res = await pool.query("SELECT * FROM commands ORDER BY created_at DESC LIMIT 5");
  console.log("LAST 5 COMMANDS:", res.rows);
  
  const counts = await pool.query("SELECT status, count(*) FROM commands GROUP BY status");
  console.log("COMMAND STATUS COUNTS:", counts.rows);

  await pool.end();
}
check();
