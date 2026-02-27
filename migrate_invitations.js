require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log("🚀 Starting User Invitations Migration...");
        await client.query("BEGIN");

        // 1. Remove NOT NULL from user_invitations.tenant_id
        console.log("🛠️ Dropping NOT NULL from user_invitations.tenant_id...");
        await client.query("ALTER TABLE user_invitations ALTER COLUMN tenant_id DROP NOT NULL;");

        await client.query("COMMIT");
        console.log("✅ Database Migration for User Invitations Successful!");
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ Migration Failed:", err);
    } finally {
        client.release();
        pool.end();
    }
}

migrate();
