require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  const res = await pool.query("SELECT * FROM commands WHERE status = 'failed' ORDER BY acked_at DESC LIMIT 1");
  console.log("LAST FAILED COMMAND:", JSON.stringify(res.rows[0], null, 2));
  await pool.end();
}
check();
