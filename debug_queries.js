require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function testQuery() {
    try {
        console.log("Testing Tenants Query...");
        const res1 = await pool.query("SELECT * FROM tenants ORDER BY created_at DESC");
        console.log("Tenants Result:", res1.rows.length, "rows found.");

        console.log("Testing Merchants Query...");
        const res2 = await pool.query("SELECT m.*, t.name as tenant_name FROM merchants m JOIN tenants t ON m.tenant_id = t.id ORDER BY m.path ASC");
        console.log("Merchants Result:", res2.rows.length, "rows found.");

        console.log("Testing Devices Query...");
        const res3 = await pool.query("SELECT d.*, m.name as merchant_name, t.name as tenant_name FROM devices d JOIN tenants t ON d.tenant_id = t.id LEFT JOIN merchants m ON d.merchant_id = m.id WHERE d.deleted_at IS NULL");
        console.log("Devices Result:", res3.rows.length, "rows found.");

    } catch (err) {
        console.error("DEBUG QUERY ERROR:", err);
    } finally {
        await pool.end();
    }
}

testQuery();
