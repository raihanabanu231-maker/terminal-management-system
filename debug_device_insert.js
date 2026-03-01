require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function test() {
    try {
        await pool.query(
            `INSERT INTO devices (serial, model, enrollment_token, enrollment_token_expires, merchant_id, tenant_id, status)
             VALUES ($1, $2, $3, NOW() + INTERVAL '10 min', $4, $5, 'pending_onboard')`,
            ['TEST-DEBUG', 'Std', 'hash_here', '63866256-62f4-4491-a024-d868a7ede422', '53401707-d50e-451d-b2dd-c49eee831e3c']
        );
        console.log('Insert Success!');
    } catch (e) {
        console.error('DB ERROR:', e.message);
    } finally {
        pool.end();
    }
}
test();
