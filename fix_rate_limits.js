const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function fixRateLimits() {
    const client = await pool.connect();
    try {
        console.log("Fixing device_rate_limits table schema...");
        await client.query("BEGIN");

        // DROP existing to recreate with new PK structure
        await client.query("DROP TABLE IF EXISTS device_rate_limits CASCADE");

        await client.query(`
            CREATE TABLE IF NOT EXISTS device_rate_limits (
                device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
                endpoint TEXT NOT NULL,
                window_start TIMESTAMPTZ,
                request_count INTEGER DEFAULT 0,
                PRIMARY KEY (device_id, endpoint)
            );
        `);

        await client.query("COMMIT");
        console.log("✅ device_rate_limits table fixed successfully.");
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("❌ Error fixing table:", error);
    } finally {
        client.release();
        await pool.end();
    }
}

fixRateLimits();
