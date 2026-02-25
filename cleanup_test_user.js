require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function cleanup() {
    const email = 'mohamedvolley0007@gmail.com';
    console.log(`🧹 Cleaning up data for: ${email}...`);

    try {
        // 1. Delete from user_invitations
        const inviteRes = await pool.query("DELETE FROM user_invitations WHERE email = $1", [email]);
        console.log(`✅ Deleted ${inviteRes.rowCount} invitations.`);

        // 2. Delete from users (also auto-deletes from user_roles via CASCADE if set up, or we do it manually)
        // First, let's find the user ID to clear roles
        const userRes = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
        if (userRes.rows.length > 0) {
            const userId = userRes.rows[0].id;
            await pool.query("DELETE FROM user_roles WHERE user_id = $1", [userId]);
            await pool.query("DELETE FROM users WHERE id = $1", [userId]);
            console.log(`✅ Deleted user and their roles.`);
        } else {
            console.log("ℹ️ No user found to delete.");
        }

        console.log("\n✨ DATABASE IS NOW CLEAN. You can send a fresh invite!");

    } catch (error) {
        console.error("❌ Cleanup failed:", error);
    } finally {
        await pool.end();
    }
}

cleanup();
