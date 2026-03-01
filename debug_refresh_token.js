require('dotenv').config();
const axios = require('axios');
const jwt = require('jsonwebtoken');

// Change this to the user's actual token to test
const emailToTest = 'mohamedrashik09724@gmail.com';

async function run() {
    try {
        console.log(`Starting login for ${emailToTest}...`);
        const login = await axios.post('https://tms-backend-atpl-2vr9.onrender.com/api/v1/auth/login', {
            email: emailToTest,
            password: 'Password123!'
        });

        console.log('Login Success. Original Token Role:', login.data.user.role);

        const refreshToken = login.data.refresh_token;

        console.log('Using refresh token to get new access token...');
        const refreshResp = await axios.post('https://tms-backend-atpl-2vr9.onrender.com/api/v1/auth/refresh', {
            refresh_token: refreshToken
        });

        const newAccessToken = refreshResp.data.access_token;
        const decoded = jwt.decode(newAccessToken);

        console.log('--- NEW ACCESS TOKEN PAYLOAD ---');
        console.log(JSON.stringify(decoded, null, 2));

    } catch (e) {
        console.error('ERROR:', e.response ? JSON.stringify(e.response.data, null, 2) : e.message);
    }
}

run();
