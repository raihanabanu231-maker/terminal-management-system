require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function check() {
  const res = await pool.query(`
    SELECT r.name, ur.scope_type, ur.scope_id 
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = '4fecc78f-56e5-4231-89ed-792262c45549'
  `);
  console.log("USER ROLES:", res.rows);
  await pool.end();
}
check();
