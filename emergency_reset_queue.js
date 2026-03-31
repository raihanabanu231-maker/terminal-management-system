require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function resetQueue() {
  try {
     // 1. Identify the active device from the last 15 mins of activity
     const activeDevice = await pool.query(`
        SELECT id, serial, last_seen 
        FROM devices 
        WHERE last_seen > NOW() - INTERVAL '30 minutes' 
        ORDER BY last_seen DESC LIMIT 1`);
     
     if (activeDevice.rows.length === 0) {
         console.warn("⚠️ No active devices found in the last 30 minutes.");
         return;
     }

     const deviceId = activeDevice.rows[0].id;
     console.log(`🔍 Found Active Device: ${activeDevice.rows[0].serial} (ID: ${deviceId})`);

     // 2. Reset commands for THIS device
     console.log(`🔃 Resetting 'failed' or 'sent' commands to 'queued'...`);
     const resetRes = await pool.query(`
        UPDATE commands 
        SET status = 'queued', acked_at = NULL, sent_at = NULL 
        WHERE device_id = $1 AND status IN ('sent', 'failed')
        RETURNING id, type`, [deviceId]);
     
     if (resetRes.rows.length === 0) {
         console.log("ℹ️ No commands were found in 'sent' or 'failed' status to reset.");
     } else {
         console.log(`✅ Reset ${resetRes.rows.length} commands to 'queued':`, resetRes.rows);
     }
     
     // 3. Confirm current Queued status
     const finalCheck = await pool.query("SELECT count(*) FROM commands WHERE device_id = $1 AND status = 'queued'", [deviceId]);
     console.log(`📊 Device now has ${finalCheck.rows[0].count} commands waiting.`);

  } catch (err) {
     console.error("❌ ERROR:", err.message);
  } finally {
     await pool.end();
  }
}
resetQueue();
