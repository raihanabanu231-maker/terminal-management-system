
require('dotenv').config();
const pool = require('./src/config/db');

async function checkColumns() {
    const tables = ['users', 'user_sessions', 'tenants', 'user_invitations', 'audit_logs'];
    for (const table of tables) {
        const r = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = $1
    `, [table]);
        console.log(`Columns for ${table}:`, r.rows.map(c => c.column_name).join(', '));
    }
    process.exit(0);
}

checkColumns().catch(e => { console.error(e); process.exit(1); });
