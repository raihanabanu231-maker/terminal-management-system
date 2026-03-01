const axios = require('axios');

async function testLive() {
    const url = 'https://tms-backend-atpl-2vr9.onrender.com/api/v1/auth/register-invite';
    const token = 'c10116ebc6868be12da1b7860639fe29a4b9749f6b5567eae21aca4d44ee3860';

    try {
        console.log(`📡 Testing POST to live server with token: ${token.substring(0, 10)}...`);
        const res = await axios.post(url, { token: token });
        console.log("Response:", res.data);
    } catch (err) {
        if (err.response) {
            console.log("❌ FAILED with Status:", err.response.status);
            console.log("❌ Response Body:", JSON.stringify(err.response.data, null, 2));
        } else {
            console.error("❌ Error:", err.message);
        }
    }
}

testLive();
