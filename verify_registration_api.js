require('dotenv').config();
const axios = require('axios');

async function testRegistrationAPI() {
    console.log("🧪 Testing Registration API...");
    try {
        // Testing against Render production URL
        const res = await axios.post('https://tms-backend-atpl.onrender.com/api/v1/auth/register-invite', {
            token: 'invalid_test_token',
            password: 'testpassword123',
            first_name: 'Test',
            last_name: 'User'
        });
        console.log("Response:", res.data);
    } catch (error) {
        if (error.response) {
            console.log("✅ API Responded with expected error:", error.response.status, error.response.data.message);
        } else {
            console.error("❌ API Unreachable:", error.message);
        }
    }
}

testRegistrationAPI();
