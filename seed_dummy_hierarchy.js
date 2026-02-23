require("dotenv").config();
const { Pool } = require("pg");
const crypto = require("crypto");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function seedDummyHierarchy() {
    const client = await pool.connect();
    try {
        console.log("🛠️ Seeding Dummy Merchant Hierarchy and Devices...");
        await client.query("BEGIN");

        // 1. Get the Alpha Corp Tenant
        const tenantRes = await client.query("SELECT id FROM tenants WHERE name = 'Alpha Corp' LIMIT 1");
        if (tenantRes.rows.length === 0) {
            console.error("❌ 'Alpha Corp' tenant not found. Please run your basic seeds first.");
            return;
        }
        const tenantId = tenantRes.rows[0].id;

        // 2. Create Top Level Merchant (Head Office)
        // Table: merchants (tenant_id, parent_id, name, external_id)
        const headOfficeRes = await client.query(
            "INSERT INTO merchants (tenant_id, name) VALUES ($1, 'Alpha HQ') RETURNING id",
            [tenantId]
        );
        const headOfficeId = headOfficeRes.rows[0].id;
        console.log(`✅ Created Head Office: Alpha HQ (${headOfficeId})`);

        // 3. Create Regional Levels
        const regions = ['Region North', 'Region South'];
        for (const rName of regions) {
            const regionRes = await client.query(
                "INSERT INTO merchants (tenant_id, parent_id, name) VALUES ($1, $2, $3) RETURNING id",
                [tenantId, headOfficeId, rName]
            );
            const regionId = regionRes.rows[0].id;
            console.log(`   ✅ Created Region: ${rName}`);

            // 4. Create Branches for each Region
            for (let i = 1; i <= 2; i++) {
                const branchName = `${rName} - Branch 0${i}`;
                const branchRes = await client.query(
                    "INSERT INTO merchants (tenant_id, parent_id, name) VALUES ($1, $2, $3) RETURNING id",
                    [tenantId, regionId, branchName]
                );
                const branchId = branchRes.rows[0].id;
                console.log(`      ✅ Created Branch: ${branchName}`);

                // 5. Add Dummy Devices to each Branch
                // Table: devices (serial, model, tenant_id, merchant_id, status)
                for (let j = 1; j <= 2; j++) {
                    const serial = `SN-${branchName.replace(/\s+|-/g, '')}-${j}`.toUpperCase();
                    await client.query(
                        `INSERT INTO devices (serial, model, tenant_id, merchant_id, status, last_seen) 
                         VALUES ($1, $2, $3, $4, 'active', NOW())`,
                        [serial, 'T-Model-X', tenantId, branchId]
                    );
                }
                console.log(`         🚀 Added 2 Devices to ${branchName}`);
            }
        }

        await client.query("COMMIT");
        console.log("\n✨ Dummy Hierarchy and Devices Seeded Successfully!");

    } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ Error seeding dummy data:", err);
    } finally {
        client.release();
        await pool.end();
    }
}

seedDummyHierarchy();
