require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  const res = await pool.query("SELECT id, serial, status, last_seen FROM devices ORDER BY last_seen DESC LIMIT 5");
  console.log("LAST 5 ACTIVE DEVICES:", res.rows);
  await pool.end();
}
check();
