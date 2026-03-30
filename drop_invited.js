const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function dropInvitedColumn() {
    const client = await pool.connect();
    try {
        console.log("🚀 Dropping 'invited' column from users table...");
        await client.query("BEGIN");
        await client.query("ALTER TABLE users DROP COLUMN IF EXISTS invited");
        await client.query("COMMIT");
        console.log("✅ Column dropped successfully.");
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("❌ Drop failed:", error);
    } finally {
        client.release();
        await pool.end();
    }
}

dropInvitedColumn();
