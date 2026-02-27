
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function restructureRoles() {
    const client = await pool.connect();
    try {
        console.log("🚀 Starting Role Restructuring...");
        await client.query("BEGIN");

        // 1. Get the Global Roles that need to be localized
        const globalRolesRes = await client.query(
            "SELECT id, name, permissions FROM roles WHERE tenant_id IS NULL AND name != 'Super Admin'"
        );
        const globalRoles = globalRolesRes.rows;
        console.log(`Found ${globalRoles.length} global roles to localize: ${globalRoles.map(r => r.name).join(', ')}`);

        // 2. Get all Tenants
        const tenantsRes = await client.query("SELECT id, name FROM tenants");
        const tenants = tenantsRes.rows;
        console.log(`Processing ${tenants.length} tenants...`);

        for (const tenant of tenants) {
            console.log(`  Processing Tenant: ${tenant.name} (${tenant.id})`);

            for (const gRole of globalRoles) {
                // 3. Create Local Role for this tenant (UPSERT style)
                let localRoleId;
                const existingRes = await client.query(
                    "SELECT id FROM roles WHERE tenant_id = $1 AND name = $2",
                    [tenant.id, gRole.name]
                );

                if (existingRes.rows.length > 0) {
                    localRoleId = existingRes.rows[0].id;
                    await client.query(
                        "UPDATE roles SET permissions = $1 WHERE id = $2",
                        [gRole.permissions, localRoleId]
                    );
                } else {
                    const insertRes = await client.query(
                        "INSERT INTO roles (tenant_id, name, permissions) VALUES ($1, $2, $3) RETURNING id",
                        [tenant.id, gRole.name, gRole.permissions]
                    );
                    localRoleId = insertRes.rows[0].id;
                }

                // 4. Update User Roles: Move users from Global Role to this Local Role for this tenant scope
                const updateRes = await client.query(
                    `UPDATE user_roles 
           SET role_id = $1 
           WHERE role_id = $2 AND scope_id = $3`,
                    [localRoleId, gRole.id, tenant.id]
                );
                if (updateRes.rowCount > 0) {
                    console.log(`    Moved ${updateRes.rowCount} users to local '${gRole.name}' role.`);
                }
            }
        }

        // 5. Delete the Global Roles (except Super Admin)
        const globalIds = globalRoles.map(r => r.id);
        if (globalIds.length > 0) {
            const deleteRes = await client.query(
                "DELETE FROM roles WHERE id = ANY($1)",
                [globalIds]
            );
            console.log(`✅ Deleted ${deleteRes.rowCount} global role templates.`);
        }

        await client.query("COMMIT");
        console.log("✨ Restructuring Complete. Only 'Super Admin' remains global.");

    } catch (err) {
        if (client) await client.query("ROLLBACK");
        console.error("❌ Restructuring failed:", err);
    } finally {
        client.release();
        await pool.end();
    }
}

restructureRoles();
