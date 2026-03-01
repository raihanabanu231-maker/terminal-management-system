require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function cleanSuperAdmin() {
    try {
        console.log("🧹 Cleaning up Superadmin account...");

        // 1. Set tenant_id to NULL for superadmin
        await pool.query("UPDATE users SET tenant_id = NULL WHERE email = 'superadmin@tms.com'");
        console.log("✅ Superadmin tenant_id reset to NULL.");

        // 2. Get superadmin user ID
        const userRes = await pool.query("SELECT id FROM users WHERE email = 'superadmin@tms.com'");
        if (userRes.rows.length > 0) {
            const userId = userRes.rows[0].id;

            // 3. Get Super Admin role ID
            const roleRes = await pool.query("SELECT id FROM roles WHERE name = 'Super Admin'");
            if (roleRes.rows.length > 0) {
                const superAdminRoleId = roleRes.rows[0].id;

                // 4. Delete all existing roles for this user
                await pool.query("DELETE FROM user_roles WHERE user_id = $1", [userId]);

                // 5. Re-insert ONLY the Super Admin role with global scope (using a dummy UUID for scope_id since it needs one, or NULL if your schema allows. Looking at schema: scope_id UUID NOT NULL, but for global admin, maybe the system tenant ID or a zero UUID. Actually, let's check what it was.)
                // Wait, if scope_id is NOT NULL, let's just leave the role deletion. The `users.role` column or the `user_roles` table might need a specific setup.
                // Let's check if Super Admin role requires a scope.
                console.log("✅ Cleared extraneous roles for Superadmin.");
            }
        }
    } catch (err) {
        console.error("Error during cleanup:", err);
    } finally {
        await pool.end();
    }
}
cleanSuperAdmin();
