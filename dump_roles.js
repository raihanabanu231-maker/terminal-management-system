require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkRoles() {
    try {
        const res = await pool.query('SELECT id, name, tenant_id FROM roles');
        fs.writeFileSync('roles_data.json', JSON.stringify(res.rows, null, 2));
    } catch (err) {
        fs.writeFileSync('roles_error.json', JSON.stringify(err, null, 2));
    } finally {
        await pool.end();
    }
}

checkRoles();
