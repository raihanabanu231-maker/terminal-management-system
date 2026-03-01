require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function describeTables() {
    const tables = ['user_invitations', 'roles', 'tenants', 'users', 'user_roles', 'user_sessions'];
    const results = {};
    for (const table of tables) {
        try {
            const res = await pool.query(`
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = $1
                ORDER BY ordinal_position
            `, [table]);
            results[table] = res.rows;
        } catch (err) {
            results[table] = { error: err.message };
        }
    }
    fs.writeFileSync('schema_output.json', JSON.stringify(results, null, 2));
    await pool.end();
}

describeTables();
