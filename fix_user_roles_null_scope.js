require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function fixConstraints() {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        console.log("🛠️ Adjusting user_roles constraints for Global Scope...");

        // 1. Drop the primary key constraint first
        console.log("🛠️ Dropping primary key on user_roles...");
        await client.query("ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_pkey;");

        // 2. Drop the NOT NULL on scope_id
        console.log("🛠️ Dropping NOT NULL on scope_id...");
        await client.query("ALTER TABLE user_roles ALTER COLUMN scope_id DROP NOT NULL;");

        // 3. Add a new primary key that is compatible with NULL scope_id
        // But in Postgres, PK columns MUST still be NOT NULL.
        // Instead, we can use a UNIQUE index if we want it to be unique across (user, role, scope).
        // Or we create a SERIAL ID as PK and a UNIQUE constraint.

        // For now, I'll just keep it without a PK but with indexes for speed.
        // Actually, I can't have a PK with a NULL column in Postgres.

        // Better: Add a dummy '00000000-0000-0000-0000-000000000000' or similar?
        // No, NULL is more professional.

        // Let's create a unique index instead of PK.
        console.log("🛠️ Adding unique index for user/role/scope...");
        await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_role_scope_unique ON user_roles (user_id, role_id, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'));");

        await client.query("COMMIT");
        console.log("✅ DONE: user_roles table is now Global-ready.");
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ Migration failed:", err);
    } finally {
        client.release();
        pool.end();
    }
}

fixConstraints();
