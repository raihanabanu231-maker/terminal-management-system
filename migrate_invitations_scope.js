require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log("🚀 Starting User Invitations Scope Fix...");
        await client.query("BEGIN");

        // 1. Remove NOT NULL from user_invitations.scope_id
        console.log("🛠️ Dropping NOT NULL from user_invitations.scope_id...");
        await client.query("ALTER TABLE user_invitations ALTER COLUMN scope_id DROP NOT NULL;");

        await client.query("COMMIT");
        console.log("✅ Database Migration for User Invitations Scope Successful!");
    } catch (err) {
        if (client) await client.query("ROLLBACK");
        console.error("❌ Migration Failed:", err);
    } finally {
        if (client) client.release();
        pool.end();
    }
}

migrate();
