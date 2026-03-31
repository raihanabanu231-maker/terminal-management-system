require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  const res = await pool.query("SELECT * FROM commands WHERE status = 'queued'");
  console.log("QUEUED COMMANDS:", res.rows);
  await pool.end();
}
check();
