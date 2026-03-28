const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function revertInvites() {
    const client = await pool.connect();
    try {
        console.log("Reverting user_invitations table schema...");
        await client.query("BEGIN");

        await client.query('ALTER TABLE user_invitations DROP COLUMN IF EXISTS first_name;');
        await client.query('ALTER TABLE user_invitations DROP COLUMN IF EXISTS last_name;');

        await client.query("COMMIT");
        console.log("✅ first_name and last_name removed successfully.");
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("❌ Error reverting table:", error);
    } finally {
        client.release();
        await pool.end();
    }
}

revertInvites();
