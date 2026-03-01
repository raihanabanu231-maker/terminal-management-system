const axios = require('axios');

const BACKEND_URL = 'https://tms-backend-atpl-2vr9.onrender.com/api/v1';

async function testLiveFlow() {
    try {
        console.log("1. Logging into Live Server...");
        const loginRes = await axios.post(`${BACKEND_URL}/auth/login`, {
            email: 'superadmin@tms.com',
            password: 'Password123!'
        });
        const accessToken = loginRes.data.access_token;

        console.log("2. Creating Test Tenant...");
        const tenantRes = await axios.post(`${BACKEND_URL}/tenants`, {
            name: `Live Test Tenant ${Date.now()}`
        }, { headers: { Authorization: `Bearer ${accessToken}` } });
        const tenantId = tenantRes.data.data.id;

        console.log("3. Creating Test Invite...");
        const inviteRes = await axios.post(`${BACKEND_URL}/users/invite`, {
            tenant_id: tenantId,
            email: `live_test_${Date.now()}@yopmail.com`,
            role_name: 'Tenant Admin'
        }, { headers: { Authorization: `Bearer ${accessToken}` } });

        const rawToken = inviteRes.data.invite_token;
        console.log(`✅ Invite Created! RAW Token Length: ${rawToken.length}`);

        console.log("4. Simulating Frontend Handshake (GET /auth/invite)...");
        try {
            const handshakeRes = await axios.get(`${BACKEND_URL}/auth/invite?token=${rawToken}`);
            console.log("✅ Handshake Success:", handshakeRes.data);
            console.log("\nIf this is successful, the browser should ALSO be successful for a fresh token.");
        } catch (err) {
            console.log("❌ Handshake Failed with Error:", err.response ? err.response.status : err.message);
            if (err.response) {
                console.log(JSON.stringify(err.response.data, null, 2));
            }
        }

    } catch (err) {
        console.error("Script Error:", err.response ? err.response.data : err.message);
    }
}
testLiveFlow();
