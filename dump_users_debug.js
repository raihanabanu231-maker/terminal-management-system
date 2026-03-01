require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function dumpUsers() {
    try {
        const res = await pool.query('SELECT id, email, tenant_id FROM users');
        fs.writeFileSync('users_dump.json', JSON.stringify(res.rows, null, 2));
        console.log(`✅ Dumped ${res.rows.length} users to users_dump.json`);
    } catch (err) {
        console.error('Error dumping users:', err.message);
    } finally {
        await pool.end();
    }
}

dumpUsers();
