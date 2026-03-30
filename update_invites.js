const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrateInvitedFlag() {
    const client = await pool.connect();
    try {
        console.log("🚀 Migrating 'invited' flag for existing users...");
        await client.query("BEGIN");

        // Set 'invited = true' for any user that exists in the user_invitations table
        const result = await client.query(`
            UPDATE users 
            SET invited = true 
            WHERE email IN (SELECT email FROM user_invitations WHERE status = 'accepted')
            AND invited = false
            RETURNING id, email
        `);

        await client.query("COMMIT");
        console.log(`✅ Successfully updated ${result.rowCount} users to 'invited=true'.`);
        result.rows.forEach(row => console.log(` - Updated: ${row.email}`));

    } catch (error) {
        await client.query("ROLLBACK");
        console.error("❌ Migration failed:", error);
    } finally {
        client.release();
        await pool.end();
    }
}

migrateInvitedFlag();
