require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'devices'");
  console.log("DEVICES:", res.rows.map(r => r.column_name));
  await pool.end();
}
check();
