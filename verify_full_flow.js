const axios = require('axios');
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const BASE_URL = 'http://localhost:5000/api/v1';
const SUPERADMIN_EMAIL = 'superadmin@tms.com';
const TEST_PASSWORD = 'Password123!';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function setup() {
    console.log("🛠️ Setting up test environment...");
    const hashedPassword = await bcrypt.hash(TEST_PASSWORD, 10);
    await pool.query("UPDATE users SET password_hash = $1 WHERE email = $2", [hashedPassword, SUPERADMIN_EMAIL]);
    console.log("✅ Superadmin password reset for testing.");
}

async function runFlow() {
    let accessToken = '';
    let tenantId = '';
    let inviteToken = '';

    try {
        await setup();

        // 1. Superadmin Login
        console.log("\n🚀 Step 1: Superadmin Login");
        const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
            email: SUPERADMIN_EMAIL,
            password: TEST_PASSWORD
        });
        accessToken = loginRes.data.access_token;
        console.log("✅ Login Successful.");

        // 2. Create Tenant
        console.log("\n🚀 Step 2: Creating Tenant");
        const tenantRes = await axios.post(`${BASE_URL}/tenants`,
            { name: "Test Hardware Corp" },
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        tenantId = tenantRes.data.data.id;
        console.log(`✅ Tenant Created: ${tenantId}`);

        // 3. Invite Tenant Admin
        console.log("\n🚀 Step 3: Inviting Tenant Admin");
        const inviteRes = await axios.post(`${BASE_URL}/users/invite`,
            {
                email: "tenantadmin_test@yopmail.com",
                role_name: "Tenant Admin",
                tenant_id: tenantId
            },
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        inviteToken = inviteRes.data.invite_token;
        console.log(`✅ Invitation Sent. Token: ${inviteToken}`);

        // 4. Handshake (Get Invite Details)
        console.log("\n🚀 Step 4: Handshake (Verify Invite)");
        const handshakeRes = await axios.get(`${BASE_URL}/auth/invite?token=${inviteToken}`);
        console.log("✅ Handshake Data:", JSON.stringify(handshakeRes.data, null, 2));

        // 5. Complete Registration
        console.log("\n🚀 Step 5: Completing Registration");
        const registerRes = await axios.post(`${BASE_URL}/auth/register-invite`, {
            token: inviteToken,
            password: "SecurePassword123!",
            first_name: "Test",
            last_name: "Admin",
            mobile: "1234567890"
        });
        console.log("✅ Registration Successful:", registerRes.data.message);

        console.log("\n🏆 FULL FLOW VERIFIED SUCCESSFULLY!");

    } catch (err) {
        console.error("\n❌ FLOW FAILED at some point:");
        if (err.response) {
            console.error("Status:", err.response.status);
            console.error("Data:", JSON.stringify(err.response.data, null, 2));
        } else {
            console.error("Error:", err.message);
        }
    } finally {
        await pool.end();
    }
}

runFlow();
