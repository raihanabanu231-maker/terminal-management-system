const axios = require('axios');

async function verifyAllEndpoints() {
    const BASE_URL = 'https://tms-backend-atpl.onrender.com/api/v1/auth';

    console.log("🔍 Checking endpoints on Render...");

    // 1. Test Invite Details (GET)
    try {
        console.log(`\nTesting: GET ${BASE_URL}/invite?token=invalid`);
        const res1 = await axios.get(`${BASE_URL}/invite?token=invalid`);
        console.log("Response:", res1.data);
    } catch (error) {
        console.log("✅ GET Invite responded:", error.response?.status, error.response?.data?.message || error.message);
    }

    // 2. Test Registration (POST)
    try {
        console.log(`\nTesting: POST ${BASE_URL}/register-invite`);
        const res2 = await axios.post(`${BASE_URL}/register-invite`, {
            token: 'invalid',
            password: 'test',
            first_name: 'test',
            last_name: 'test'
        });
        console.log("Response:", res2.data);
    } catch (error) {
        console.log("✅ POST Register responded:", error.response?.status, error.response?.data?.message || error.message);
    }
}

verifyAllEndpoints();
