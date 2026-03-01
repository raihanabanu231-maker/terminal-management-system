const axios = require('axios');
const fs = require('fs');

const BACKEND_URL = 'https://tms-backend-atpl-2vr9.onrender.com/api/v1';
const FRONTEND_URL = 'https://atpl-tms-frontend.onrender.com';

async function generateFreshLink() {
    try {
        const loginRes = await axios.post(`${BACKEND_URL}/auth/login`, {
            email: 'superadmin@tms.com',
            password: 'Password123!'
        });
        const accessToken = loginRes.data.access_token;

        const tenantRes = await axios.post(`${BACKEND_URL}/tenants`, {
            name: `Browser Test Tenant ${Date.now()}`
        }, { headers: { Authorization: `Bearer ${accessToken}` } });
        const tenantId = tenantRes.data.data.id;

        const inviteRes = await axios.post(`${BACKEND_URL}/users/invite`, {
            tenant_id: tenantId,
            email: `browser_test_${Date.now()}@yopmail.com`,
            role_name: 'Tenant Admin'
        }, { headers: { Authorization: `Bearer ${accessToken}` } });

        const rawToken = inviteRes.data.invite_token;
        const fullLink = `${FRONTEND_URL}/register?token=${rawToken}`;

        fs.writeFileSync('fresh_link.txt', fullLink);
        console.log(`✅ FRESH LINK SAVED TO fresh_link.txt`);

    } catch (err) {
        console.error("Error:", err.response ? err.response.data : err.message);
    }
}
generateFreshLink();
