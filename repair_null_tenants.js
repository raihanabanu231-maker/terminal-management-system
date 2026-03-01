require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const SYSTEM_ID = 'f8261f95-d148-4c77-9e80-d254129a8843';

async function repairInvites() {
    try {
        console.log(`🛠️ Repairing invitations with NULL tenant_id to use System ID: ${SYSTEM_ID}`);

        // 1. Repair user_invitations
        const res1 = await pool.query(
            "UPDATE user_invitations SET tenant_id = $1, scope_id = COALESCE(scope_id, $1) WHERE tenant_id IS NULL OR scope_id IS NULL",
            [SYSTEM_ID]
        );
        console.log(`Updated ${res1.rowCount} invalid invitations.`);

        // 2. Repair any users with NULL tenant_id
        const res2 = await pool.query(
            "UPDATE users SET tenant_id = $1 WHERE tenant_id IS NULL",
            [SYSTEM_ID]
        );
        console.log(`Updated ${res2.rowCount} global users to belong to System Tenant.`);

    } catch (e) {
        console.error("Repair Failed:", e);
    } finally {
        await pool.end();
    }
}

repairInvites();
