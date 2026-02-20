const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api';
let superToken;
let tenantAdminToken;
let operatorToken;
let tenantId;
let merchantId;

async function runFlow() {
    try {
        console.log("\n🚀 Starting End-to-End Flow Test...\n");

        const suffix = Date.now();
        const adminEmail = `admin${suffix}@alpha.com`;
        const operatorEmail = `op${suffix}@alpha.com`;

        // 1. Super Admin Login
        console.log("1️⃣  Logging in as Super Admin...");
        const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
            email: "superadmin@tms.com",
            password: "admin"
        });
        superToken = loginRes.data.token;
        console.log("✅ Super Admin Logged In");

        // 2. Create Tenant
        console.log(`\n2️⃣  Creating Tenant 'Alpha Payments ${suffix}'...`);
        const tenantRes = await axios.post(`${BASE_URL}/tenants`, {
            name: `Alpha Payments ${suffix}`
        }, { headers: { Authorization: `Bearer ${superToken}` } });
        tenantId = tenantRes.data.data.id;
        console.log(`✅ Tenant Created (ID: ${tenantId})`);

        // 3. Invite Tenant Admin
        console.log(`\n3️⃣  Inviting Tenant Admin (${adminEmail})...`);
        const inviteAdminRes = await axios.post(`${BASE_URL}/users/invite`, {
            email: adminEmail,
            role: "TENANT_ADMIN",
            tenant_id: tenantId,
            name: "Alpha Admin"
        }, { headers: { Authorization: `Bearer ${superToken}` } });

        const adminInviteToken = inviteAdminRes.data.invite_token;
        console.log(`✅ Invitation Sent (Token: ${adminInviteToken})`);

        // 4. Register Tenant Admin
        console.log("\n4️⃣  Registering Tenant Admin...");
        await axios.post(`${BASE_URL}/auth/register`, {
            token: adminInviteToken,
            password: "admin",
            name: "Alpha Admin"
        });
        console.log("✅ Tenant Admin Registered");

        // 5. Tenant Admin Login
        console.log("\n5️⃣  Logging in as Tenant Admin...");
        const adminLoginRes = await axios.post(`${BASE_URL}/auth/login`, {
            email: adminEmail,
            password: "admin"
        });
        tenantAdminToken = adminLoginRes.data.token;
        console.log("✅ Tenant Admin Logged In");

        // 6. Create Merchant (Scope)
        console.log("\n6️⃣  Creating Merchant 'Riyadh Region'...");
        const merchantRes = await axios.post(`${BASE_URL}/merchants`, {
            name: "Riyadh Region"
        }, { headers: { Authorization: `Bearer ${tenantAdminToken}` } });
        merchantId = merchantRes.data.data.id;
        console.log(`✅ Merchant Created (ID: ${merchantId})`);

        // 7. Invite Operator (Scoped)
        console.log(`\n7️⃣  Inviting Scoped Operator (${operatorEmail})...`);
        const inviteOpRes = await axios.post(`${BASE_URL}/users/invite`, {
            email: operatorEmail,
            role: "OPERATOR",
            merchant_id: merchantId,
            name: "Operator User"
        }, { headers: { Authorization: `Bearer ${tenantAdminToken}` } });

        const opInviteToken = inviteOpRes.data.invite_token;
        console.log(`✅ Operator Invited (Token: ${opInviteToken})`);

        // 8. Register Operator
        console.log("\n8️⃣  Registering Operator...");
        await axios.post(`${BASE_URL}/auth/register`, {
            token: opInviteToken,
            password: "admin",
            name: "Operator User"
        });
        console.log("✅ Operator Registered");

        // 9. Operator Login
        console.log("\n9️⃣  Logging in as Operator...");
        const opLoginRes = await axios.post(`${BASE_URL}/auth/login`, {
            email: operatorEmail,
            password: "admin"
        });
        operatorToken = opLoginRes.data.token;
        console.log("✅ Operator Logged In! Full Flow Complete!");

    } catch (error) {
        console.error("❌ Flow Failed:", error.response ? error.response.data : error.message);
    }
}

runFlow();
