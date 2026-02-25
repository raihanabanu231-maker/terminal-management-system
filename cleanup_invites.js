require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function runCleanup() {
    try {
        console.log("--- TOTAL RESET START ---");

        // Delete ALL pending invitations for a total reset
        const res = await pool.query(`
            DELETE FROM user_invitations 
            WHERE status = 'pending'
        `);

        console.log(`✅ Successfully deleted ALL ${res.rowCount} pending invitations.`);

        // Check current pending invites
        const pending = await pool.query(`
            SELECT email, token_hash, created_at 
            FROM user_invitations 
            WHERE status = 'pending' 
            ORDER BY created_at DESC
        `);

        if (pending.rows.length > 0) {
            console.log("\n🚀 REMAINING PENDING INVITES:");
            pending.rows.forEach(row => {
                console.log(`- Email: ${row.email} (Created: ${row.created_at})`);
            });
        } else {
            console.log("\n📭 No pending invites left.");
        }

    } catch (err) {
        console.error("CLEANUP ERROR:", err);
    } finally {
        await pool.end();
    }
}

runCleanup();
