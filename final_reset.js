require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
    try {
        const res = await pool.query("UPDATE commands SET status = 'queued', acked_at = NULL, sent_at = NULL");
        console.log(`✅ Successfully reset ${res.rowCount} commands to 'queued'.`);
        
        const deviceCheck = await pool.query("SELECT id, type, status FROM commands WHERE device_id = 'a314501f-2c31-4a1c-97e5-27484179cba9' AND status = 'queued'");
        console.log(`📊 Device a314... has ${deviceCheck.rows.length} commands waiting.`);
    } catch (err) {
        console.error("❌ Reset Error:", err.message);
    } finally {
        await pool.end();
    }
}
run();
