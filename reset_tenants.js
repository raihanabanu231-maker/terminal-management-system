require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function resetTenants() {
    const client = await pool.connect();
    try {
        console.log("🔥 Starting Database Reset (Wiping Tenants)...");
        await client.query("BEGIN");

        // 1. Delete all tenants. This will cascade to:
        // merchants, tenant-specific users, tenant-specific roles, etc.
        const delRes = await client.query("DELETE FROM tenants");
        console.log(`✅ Deleted ${delRes.rowCount} tenants.`);

        // 2. Clear orphaned stuff that might not have cascaded perfectly or needs a clean slate
        await client.query("DELETE FROM user_invitations");
        console.log("✅ Cleared user_invitations.");

        await client.query("DELETE FROM audit_logs");
        console.log("✅ Cleared audit_logs.");

        // 3. Keep ONLY the superadmin user
        const userDelRes = await client.query("DELETE FROM users WHERE email != 'superadmin@tms.com'");
        console.log(`✅ Deleted ${userDelRes.rowCount} other users.`);

        // 4. Reset User Roles for Super Admin to be truly global (scope_id = NULL or dummy if allowed)
        // First, find the Super Admin Role
        const roleRes = await client.query("SELECT id FROM roles WHERE name = 'Super Admin' AND tenant_id IS NULL LIMIT 1");
        if (roleRes.rows.length > 0) {
            const roleId = roleRes.rows[0].id;
            const adminRes = await client.query("SELECT id FROM users WHERE email = 'superadmin@tms.com'");
            if (adminRes.rows.length > 0) {
                const adminId = adminRes.rows[0].id;

                // Clear all roles first
                await client.query("DELETE FROM user_roles WHERE user_id = $1", [adminId]);

                // Assign global role (we use a placeholder UUID like all zeros or just NULL if supported)
                // Note: init_db.js says scope_id UUID NOT NULL. 
                // We'll use a constant like '00000000-0000-0000-0000-000000000000' for global scope if needed,
                // or just let it be empty if the migration allowed NULL.

                // Let's check if scope_id is nullable
                const scopeColRes = await client.query("SELECT is_nullable FROM information_schema.columns WHERE table_name = 'user_roles' AND column_name = 'scope_id'");
                const isNullable = scopeColRes.rows[0].is_nullable === 'YES';

                if (isNullable) {
                    await client.query(
                        "INSERT INTO user_roles (user_id, role_id, scope_type, scope_id) VALUES ($1, $2, 'tenant', NULL)",
                        [adminId, roleId]
                    );
                } else {
                    // Use zeros as a fallback for "Global" scope
                    await client.query(
                        "INSERT INTO user_roles (user_id, role_id, scope_type, scope_id) VALUES ($1, $2, 'tenant', '00000000-0000-0000-0000-000000000000')",
                        [adminId, roleId]
                    );
                }
                console.log("✅ Super Admin role reset to Global Scope.");
            }
        }

        await client.query("COMMIT");
        console.log("🎉 Database reset successfully. System is now clean.");

    } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ Error resetting database:", err);
    } finally {
        client.release();
        pool.end();
    }
}

resetTenants();
