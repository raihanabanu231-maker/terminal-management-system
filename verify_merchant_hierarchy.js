require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function runTests() {
    try {
        console.log("--- Starting Merchant Hierarchy Tests ---");

        // 1. Get a valid tenant_id
        const tenantRes = await pool.query("SELECT id FROM tenants LIMIT 1");
        if (tenantRes.rows.length === 0) {
            console.log("No tenants found to run tests.");
            return;
        }
        const tenant_id = tenantRes.rows[0].id;
        console.log(`Using Tenant: ${tenant_id}`);

        // 2. Simulate creating a Top-Level Region (e.g., North America)
        const regionId = crypto.randomUUID();
        const regionPath = `${regionId}.`;

        await pool.query(
            `INSERT INTO merchants (id, name, tenant_id, parent_id, path) 
             VALUES ($1, $2, $3, NULL, $4)`,
            [regionId, 'Test Region - North America', tenant_id, regionPath]
        );
        console.log(`✅ Created Parent Region: ${regionId} (Path: ${regionPath})`);

        // 3. Simulate creating a Child Store under that Region (e.g., Times Square)
        const storeId = crypto.randomUUID();
        // The API controller logic would do this:
        const storePath = `${regionPath}${storeId}.`;

        await pool.query(
            `INSERT INTO merchants (id, name, tenant_id, parent_id, path) 
             VALUES ($1, $2, $3, $4, $5)`,
            [storeId, 'Test Store - Times Square', tenant_id, regionId, storePath]
        );
        console.log(`✅ Created Child Store: ${storeId} (Path: ${storePath})`);

        // 4. Verify the Query Logic for a Store Manager
        // A store manager scoped to "North America" should see both records
        const query = `
            SELECT id, name, path 
            FROM merchants 
            WHERE tenant_id = $1 
            AND path LIKE (SELECT path FROM merchants WHERE id = $2) || '%'
            ORDER BY path ASC
        `;
        const result = await pool.query(query, [tenant_id, regionId]);

        console.log(`\n🔍 Hierarchy Query Results (Scoped to North America):`);
        console.table(result.rows);

        if (result.rows.length === 2 && result.rows[1].path.startsWith(result.rows[0].path)) {
            console.log("\n🎯 TEST PASSED: The descendant tree is correctly generated and queried!");
        } else {
            console.log("\n❌ TEST FAILED: Hierarchy logic is broken.");
        }

        // Cleanup
        await pool.query("DELETE FROM merchants WHERE id IN ($1, $2)", [regionId, storeId]);
        console.log("🧹 Cleaned up test data.");

    } catch (e) {
        console.error("Test Error:", e);
    } finally {
        await pool.end();
    }
}

runTests();
