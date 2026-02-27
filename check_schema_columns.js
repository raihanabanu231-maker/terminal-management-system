
require('dotenv').config();
const pool = require('./src/config/db');

async function checkSchema() {
    const tables = ['users', 'tenants', 'user_invitations', 'user_sessions'];
    for (const table of tables) {
        const r = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name = $1
      ORDER BY ordinal_position
    `, [table]);
        console.log(`\n--- Table: ${table} ---`);
        console.table(r.rows);
    }
    process.exit(0);
}

checkSchema().catch(e => { console.error(e); process.exit(1); });
