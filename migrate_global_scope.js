require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log("🚀 Expanding Global Admin Migration...");
        await client.query("BEGIN");

        // 1. Drop NOT NULL on user_roles.scope_id
        console.log("🛠️ Dropping NOT NULL from user_roles.scope_id...");
        await client.query("ALTER TABLE user_roles ALTER COLUMN scope_id DROP NOT NULL;");

        // 2. Move Super Admin Role Assignment to Global Scope (NULL)
        console.log("🛠️ Moving Super Admin permissions to Global Scope...");
        await client.query(`
      UPDATE user_roles 
      SET scope_id = NULL 
      WHERE user_id IN (SELECT id FROM users WHERE email = 'superadmin@tms.com')
    `);

        await client.query("COMMIT");
        console.log("✅ Final Constraints Updated Successfully!");
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ Migration Failed:", err);
    } finally {
        client.release();
        pool.end();
    }
}

migrate();
