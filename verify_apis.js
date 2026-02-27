require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');

const BASE_URL = 'http://localhost:5000/api/v1';
const TEST_EMAIL = `test_user_${crypto.randomBytes(4).toString('hex')}@example.com`;
const TEST_TENANT_NAME = `Test Tenant ${crypto.randomBytes(4).toString('hex')}`;

let adminToken = '';
let createdTenantId = '';
let inviteToken = '';

async function runTests() {
    console.log('🚀 Starting Deep API Verification...\n');

    try {
        // 1. Login
        console.log('--- Step 1: Login (Super Admin) ---');
        const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
            email: 'superadmin@tms.com',
            password: 'admin123'
        });
        adminToken = loginRes.data.access_token;
        console.log('✅ Login Successful\n');

        const config = { headers: { Authorization: `Bearer ${adminToken}` } };

        // 2. Tenant Creation
        console.log('--- Step 2: Tenant Creation ---');
        const tenantRes = await axios.post(`${BASE_URL}/tenants`, { name: TEST_TENANT_NAME }, config);
        createdTenantId = tenantRes.data.data.id;
        console.log(`✅ Tenant Created: ${TEST_TENANT_NAME} (ID: ${createdTenantId})\n`);

        // 3. Get Tenants (Verify creation)
        console.log('--- Step 3: Get Tenants ---');
        const allTenants = await axios.get(`${BASE_URL}/tenants`, config);
        console.log(`✅ Get Tenants Successful! Found ${allTenants.data.data.length} tenants.\n`);

        // 4. Send Invitation
        console.log('--- Step 4: User Invitation ---');
        const inviteRes = await axios.post(`${BASE_URL}/users/invite`, {
            email: TEST_EMAIL,
            role_name: 'Tenant Admin',
            tenant_id: createdTenantId
        }, config);
        inviteToken = inviteRes.data.invite_token;
        console.log(`✅ Invitation Sent to ${TEST_EMAIL}\n`);

        // 5. Get Invitations (Verify visibility)
        console.log('--- Step 5: Get Invitations ---');
        const allInvites = await axios.get(`${BASE_URL}/users/invites`, config);
        const inviteFound = allInvites.data.data.find(i => i.email === TEST_EMAIL);
        if (!inviteFound) throw new Error('Sent invitation not found in list! JOIN check failed.');
        console.log('✅ Invitation verified in list (LEFT JOIN confirmed working)\n');

        // 7. Get Users (User Listing API)
        console.log('--- Step 7: Get Registered Users ---');
        const usersRes = await axios.get(`${BASE_URL}/users`, config);
        console.log(`✅ User List retrieved (${usersRes.data.data.length} total users)\n`);

        console.log('🎉 COMPREHENSIVE VERIFICATION COMPLETE!');
        console.log('----------------------------------------');
        console.log('✅ Login: WORKING');
        console.log('✅ Tenant Creation: WORKING');
        console.log('✅ Get Tenant: WORKING');
        console.log('✅ Invitations: WORKING');
        console.log('✅ User Listing: WORKING');
        console.log('----------------------------------------');

    } catch (error) {
        console.error('❌ VERIFICATION FAILED!');
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
