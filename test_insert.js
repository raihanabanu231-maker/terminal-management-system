require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function test() {
  const deviceId = '1930ad15-1f12-40e3-8533-326604052e5b';
  const tenantId = '7d547cb7-b8fd-40ab-9097-6f890563c77d';
  try {
    await pool.query('INSERT INTO device_audit_logs (device_id, tenant_id, event_type, message, timestamp) VALUES ($1, $2, $3, $4, NOW())', [deviceId, tenantId, 'TEST', 'Self-test log entry']);
    console.log('✅ TEST_INSERT_SUCCESS');
  } catch (err) {
    console.error('❌ TEST_INSERT_FAIL:', err.message);
  } finally {
    await pool.end();
  }
}
test();
