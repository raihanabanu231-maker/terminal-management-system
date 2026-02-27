
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function cleanup() {
    const client = await pool.connect();
    try {
        console.log("🔍 Analyzing duplicates...");

        // 1. Get all Super Admin roles
        const rolesRes = await client.query(
            "SELECT id FROM roles WHERE name = 'Super Admin' AND tenant_id IS NULL"
        );

        if (rolesRes.rows.length <= 1) {
            console.log("✅ No duplicates found.");
            return;
        }

        const allIds = rolesRes.rows.map(r => r.id);
        const keepId = allIds[0];
        const deleteIds = allIds.slice(1);

        console.log(`Keeping ID: ${keepId}`);
        console.log(`Deleting IDs: ${deleteIds.length} duplicates...`);

        await client.query("BEGIN");

        // 2. Update user_roles to point to the keepId
        const updateUsers = await client.query(
            "UPDATE user_roles SET role_id = $1 WHERE role_id = ANY($2)",
            [keepId, deleteIds]
        );
        console.log(`Updated ${updateUsers.rowCount} user_role assignments.`);

        // 3. Update user_invitations to point to the keepId
        const updateInvites = await client.query(
            "UPDATE user_invitations SET role_id = $1 WHERE role_id = ANY($2)",
            [keepId, deleteIds]
        );
        console.log(`Updated ${updateInvites.rowCount} invitations.`);

        // 4. Delete duplicates from roles
        const deleteRes = await client.query(
            "DELETE FROM roles WHERE id = ANY($1)",
            [deleteIds]
        );
        console.log(`Deleted ${deleteRes.rowCount} duplicate roles.`);

        await client.query("COMMIT");
        console.log("✅ Cleanup complete.");

    } catch (err) {
        if (client) await client.query("ROLLBACK");
        console.error("❌ Cleanup failed:", err);
    } finally {
        client.release();
        await pool.end();
    }
}

cleanup();
