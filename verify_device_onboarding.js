require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');
const axios = require('axios');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const API_BASE = "http://localhost:" + (process.env.PORT || 8080) + "/api/v1";

async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAdminToken() {
    // For testing, just grab any user and sign a fake JWT with SUPER_ADMIN role
    const res = await pool.query(`SELECT id, tenant_id FROM users LIMIT 1`);
    if (res.rows.length === 0) throw new Error("No users found in database");

    const jwt = require("jsonwebtoken");
    const token = jwt.sign(
        {
            id: res.rows[0].id,
            tenant_id: res.rows[0].tenant_id,
            role: "SUPER_ADMIN"
        },
        process.env.JWT_SECRET || "fallback_secret",
        { expiresIn: "1h" }
    );

    return token;
}

async function runTests() {
    let merchant_id = null;
    let tenant_id = null;
    let enrollmentToken = null;
    const testSerial = `TEST-DEV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    try {
        console.log("--- Starting Device Onboarding Tests ---");

        // 1. Setup: Get a valid tenant and merchant
        const testDataRes = await pool.query("SELECT id, tenant_id FROM merchants LIMIT 1");
        if (testDataRes.rows.length === 0) {
            console.log("⚠️ No merchants found. Creating a temporary one for testing.");
            const tRes = await pool.query("SELECT id FROM tenants LIMIT 1");
            tenant_id = tRes.rows[0].id;

            const insertRes = await pool.query(
                "INSERT INTO merchants (id, name, tenant_id, parent_id, path) VALUES ($1::uuid, 'Onboard Test Store', $2, NULL, $1::text || '.') RETURNING id",
                [crypto.randomUUID(), tenant_id]
            );
            merchant_id = insertRes.rows[0].id;
        } else {
            merchant_id = testDataRes.rows[0].id;
            tenant_id = testDataRes.rows[0].tenant_id;
        }

        console.log(`Using Tenant: ${tenant_id}`);
        console.log(`Using Merchant: ${merchant_id}`);

        const token = await getAdminToken();
        const headers = { Authorization: `Bearer ${token}` };

        // 2. Pre-Register / Generate Token
        console.log(`\n⏳ Simulating Store Manager Pre-Registering device: ${testSerial}...`);

        const preRegResponse = await axios.post(`${API_BASE}/devices/enroll-token`, {
            serial: testSerial,
            model: "PAX-A920",
            merchant_id: merchant_id,
            tenant_id: tenant_id // Required for superadmin
        }, { headers, validateStatus: () => true });

        if (preRegResponse.status !== 200) {
            throw new Error(`Pre-registration failed: ${JSON.stringify(preRegResponse.data)}`);
        }

        enrollmentToken = preRegResponse.data.token;
        console.log(`✅ Pre-Registration successful! Generated Token: [${enrollmentToken.substring(0, 8)}***]`);

        // Let DB settle
        await sleep(500);

        // 3. Simulate Physical Device Boot / Enrollment
        console.log(`\n⏳ Simulating physical terminal scanning QR code and enrolling...`);

        const enrollResponse = await axios.post(`${API_BASE}/devices/enroll`, {
            token: enrollmentToken,
            serial: testSerial
        }, { validateStatus: () => true });

        if (enrollResponse.status !== 200) {
            throw new Error(`Enrollment failed: ${JSON.stringify(enrollResponse.data)}`);
        }

        console.log(`✅ Physical Enrollment successful! Terminal received JWT Device Token.`);

        // 4. Verify DB State
        const dbVerify = await pool.query("SELECT status, merchant_id FROM devices WHERE serial = $1", [testSerial]);
        console.log(`\n🔍 Database State Post-Enrollment:`);
        console.table(dbVerify.rows);

        if (dbVerify.rows.length === 1 && dbVerify.rows[0].status === 'active') {
            console.log("\n🎯 TEST PASSED: Full device onboarding flow works end-to-end!");
        } else {
            console.log("\n❌ TEST FAILED: Device status was not updated to active.");
        }

        // Cleanup
        await pool.query("DELETE FROM devices WHERE serial = $1", [testSerial]);
        console.log("🧹 Cleaned up test device.");

    } catch (e) {
        if (e.response) {
            console.error("Test API Error:", e.response.status, e.response.data);
        } else {
            console.error("Test Error:", e.message);
        }
    } finally {
        await pool.end();
    }
}

runTests();
