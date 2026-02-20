const axios = require('axios');

const BASE_URL = 'https://tms-backend-atpl-2vr9.onrender.com/api';

async function testLive() {
    try {
        console.log("\n🌐 Testing Live Render Deployment...");
        console.log(`URL: ${BASE_URL}\n`);

        // 1. Health Check
        console.log("🔍 Checking API Health...");
        const health = await axios.get('https://tms-backend-atpl-2vr9.onrender.com/');
        console.log(`✅ Health Status: ${health.data}`);

        // 2. Super Admin Login
        console.log("\n🔑 Logging in as Super Admin...");
        const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
            email: "superadmin@tms.com",
            password: "admin"
        });
        const token = loginRes.data.token;
        console.log("✅ Live Login Successful!");

        // 3. Test Audit Logic (Triggered by login/activity)
        console.log("\n📜 Fetching verification data (confirming DB link)...");
        // We'll create a tenant to trigger an audit log and verify DB persistence
        const suffix = Math.floor(Math.random() * 1000);
        const tenantRes = await axios.post(`${BASE_URL}/tenants`, {
            name: `Live Test Tenant ${suffix}`
        }, { headers: { Authorization: `Bearer ${token}` } });

        console.log(`✅ Tenant Created on Render Cloud (ID: ${tenantRes.data.data.id})`);
        console.log("\n🚀 EVERYTHING IS LIVE AND WORKING!");

    } catch (error) {
        console.error("❌ Live Test Failed:", error.response ? error.response.data : error.message);
        console.log("\nTIP: Make sure you added the Environment Variables in the Render Dashboard!");
    }
}

testLive();
