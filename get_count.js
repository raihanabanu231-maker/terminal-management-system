require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    const res = await pool.query("SELECT count(*) FROM user_invitations");
    console.log('Invitations Count:', res.rows[0].count);
    process.exit(0);
}
run();
