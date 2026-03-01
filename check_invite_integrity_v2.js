require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkInviteIntegrity() {
    try {
        console.log("🔍 Checking user_invitations for potential crash triggers...");

        const countRes = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status IS NULL) as null_status,
                COUNT(*) FILTER (WHERE expires_at IS NULL) as null_expires,
                COUNT(*) FILTER (WHERE token_hash IS NULL) as null_hash,
                COUNT(*) FILTER (WHERE tenant_id IS NULL) as null_tenant,
                COUNT(*) FILTER (WHERE role_id IS NULL) as null_role
            FROM user_invitations
        `);
        console.log("Counts:", JSON.stringify(countRes.rows, null, 2));

        const recent = await pool.query(`
            SELECT id, email, status, created_at, expires_at 
            FROM user_invitations 
            ORDER BY created_at DESC 
            LIMIT 5
        `);
        console.log("Recent Invitations:", JSON.stringify(recent.rows, null, 2));

        // Check for orphaned invitations (roles or tenants deleted)
        const orphaned = await pool.query(`
            SELECT ui.id, ui.email, ui.role_id, ui.tenant_id
            FROM user_invitations ui
            LEFT JOIN roles r ON ui.role_id = r.id
            LEFT JOIN tenants t ON ui.tenant_id = t.id
            WHERE r.id IS NULL OR t.id IS NULL
            LIMIT 5
        `);
        console.log("Orphaned Invitations (missing role/tenant):", JSON.stringify(orphaned.rows, null, 2));

    } catch (err) {
        console.error("❌ Integrity Check Failed:", err);
    } finally {
        await pool.end();
    }
}

checkInviteIntegrity();
