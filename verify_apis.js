require('dotenv').config();
const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api/v1';
let token = '';

async function runTests() {
    console.log('🚀 Starting Comprehensive API Verification...\n');

    try {
        // 1. Login
        console.log('--- 1. Testing Login (Super Admin) ---');
        const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
            email: 'superadmin@tms.com',
            password: process.env.TEST_ADMIN_PASSWORD || 'your_secure_password' // Fallback for local
        });
        token = loginRes.data.access_token;
        console.log('✅ Login Successful\n');

        const config = { headers: { Authorization: `Bearer ${token}` } };

        // 2. Get Users (New API)
        console.log('--- 2. Testing Get Users (Registered Users) ---');
        const usersRes = await axios.get(`${BASE_URL}/users`, config);
        console.log(`✅ Get Users Successful: Found ${usersRes.data.data.length} users\n`);

        // 3. Get Tenants
        console.log('--- 3. Testing Get Tenants ---');
        const tenantsRes = await axios.get(`${BASE_URL}/tenants`, config);
        console.log(`✅ Get Tenants Successful: Found ${tenantsRes.data.data.length} tenants\n`);

        // 4. Get Invitations
        console.log('--- 4. Testing Get Invitations ---');
        const invitesRes = await axios.get(`${BASE_URL}/users/invites`, config);
        console.log(`✅ Get Invitations Successful: Found ${invitesRes.data.data.length} invites\n`);

        // 5. Get Merchants
        console.log('--- 5. Testing Get Merchants ---');
        const merchantsRes = await axios.get(`${BASE_URL}/merchants`, config);
        console.log(`✅ Get Merchants Successful: Found ${merchantsRes.data.data.length} merchants\n`);

        // 6. Get Dashboard Stats
        console.log('--- 6. Testing Dashboard Stats ---');
        const statsRes = await axios.get(`${BASE_URL}/dashboard/stats`, config);
        console.log('✅ Get Dashboard Stats Successful\n');

        // 7. Get Devices
        console.log('--- 7. Testing Get Devices ---');
        const devicesRes = await axios.get(`${BASE_URL}/devices`, config);
        console.log(`✅ Get Devices Successful: Found ${devicesRes.data.data.length} devices\n`);

        console.log('🎉 ALL CORE APIS ARE WORKING CORRECTLY!');
    } catch (error) {
        console.error('❌ API Verification Failed!');
        if (error.response) {
            console.error('   Status:', error.response.status);
            console.error('   Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('   Error:', error.message);
        }
        process.exit(1);
    }
}

runTests();
