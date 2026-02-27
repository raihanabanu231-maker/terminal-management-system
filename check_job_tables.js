
require('dotenv').config();
const pool = require('./src/config/db');

async function checkTables() {
    const tables = ['devices', 'device_telemetry', 'commands', 'audit_logs', 'device_incidents', 'incident_events'];
    for (const table of tables) {
        const r = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE  table_schema = 'public'
        AND    table_name   = $1
      );
    `, [table]);
        console.log(`Table ${table} exists: ${r.rows[0].exists}`);
    }
    process.exit(0);
}

checkTables().catch(e => { console.error(e); process.exit(1); });
