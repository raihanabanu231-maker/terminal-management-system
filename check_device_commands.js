require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  const res = await pool.query("SELECT status, count(*) FROM commands WHERE device_id = 'a314501f-2c31-4a1c-97e5-27484179cba9' GROUP BY status");
  console.log("DEVICE a314... COMMAND STATUSES:", res.rows);
  await pool.end();
}
check();
