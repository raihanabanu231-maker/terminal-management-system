require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  const res = await pool.query("SELECT * FROM commands WHERE created_at > NOW() - INTERVAL '1 hour' ORDER BY created_at DESC");
  console.log("COMMANDS IN LAST HOUR:", res.rows);
  await pool.end();
}
check();
