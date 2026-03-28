const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function removeAndroidId() {
    const client = await pool.connect();
    try {
        console.log("Removing android_id column from devices table...");
        await client.query("BEGIN");

        await client.query('ALTER TABLE devices DROP COLUMN IF EXISTS android_id;');

        await client.query("COMMIT");
        console.log("✅ android_id removed successfully. System is now Serial-only.");
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("❌ Error removing column:", error);
    } finally {
        client.release();
        await pool.end();
    }
}

removeAndroidId();
