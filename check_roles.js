
require('dotenv').config();
const pool = require('./src/config/db');

async function checkRoles() {
    const r = await pool.query("SELECT name FROM roles");
    console.log(JSON.stringify(r.rows, null, 2));
    process.exit(0);
}

checkRoles().catch(e => { console.error(e); process.exit(1); });
