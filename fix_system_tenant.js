require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});
async function run() {
    try {
        // 1. Ensure System Tenant exists
        const tRes = await pool.query("INSERT INTO tenants (name, status) VALUES ('System', 'active') ON CONFLICT DO NOTHING RETURNING id");
        let systemId = tRes.rows[0]?.id;
        if (!systemId) {
            const existing = await pool.query("SELECT id FROM tenants WHERE name = 'System' LIMIT 1");
            systemId = existing.rows[0].id;
        }
        console.log('SYSTEM_TENANT_ID=' + systemId);

        // 2. Link Super Admin to System Tenant if they have NULL
        await pool.query("UPDATE users SET tenant_id = $1 WHERE email = 'superadmin@tms.com' AND tenant_id IS NULL", [systemId]);
        console.log('SuperAdmin linked to System Tenant.');

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
