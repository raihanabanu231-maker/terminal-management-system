require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function describeDefaults() {
    const tables = ['user_invitations', 'roles', 'tenants', 'users'];
    const results = {};
    for (const table of tables) {
        try {
            const res = await pool.query(`
                SELECT column_name, column_default
                FROM information_schema.columns
                WHERE table_name = $1
                ORDER BY ordinal_position
            `, [table]);
            results[table] = res.rows;
        } catch (err) {
            results[table] = { error: err.message };
        }
    }
    fs.writeFileSync('defaults_output.json', JSON.stringify(results, null, 2));
    await pool.end();
}

describeDefaults();
