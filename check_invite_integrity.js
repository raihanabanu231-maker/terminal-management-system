require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkInviteIntegrity() {
    try {
        console.log("🔍 Checking user_invitations for potential crash triggers...");

        // Check for any NULL values in critical columns that might cause issues during processing
        const res = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status IS NULL) as null_status,
                COUNT(*) FILTER (WHERE expires_at IS NULL) as null_expires,
                COUNT(*) FILTER (WHERE token_hash IS NULL) as null_hash,
                COUNT(*) FILTER (WHERE tenant_id IS NULL) as null_tenant
            FROM user_invitations
        `);
        console.table(res.rows);

        console.log("\n🔍 Checking for invitations that might be triggering 500s...");
        const details = await pool.query(`
            SELECT id, email, status, created_at, expires_at 
            FROM user_invitations 
            ORDER BY created_at DESC 
            LIMIT 10
        `);
        console.table(details.rows);

    } catch (err) {
        console.error("❌ Integrity Check Failed:", err);
    } finally {
        await pool.end();
    }
}

checkInviteIntegrity();
