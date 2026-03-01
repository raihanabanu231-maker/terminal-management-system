require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');

const BASE_URL = 'http://localhost:5000/api/v1';
const TEST_EMAIL = `verify_registration_${crypto.randomBytes(4).toString('hex')}@example.com`;
const TEST_TENANT = `Verification Tenant ${crypto.randomBytes(4).toString('hex')}`;

async function verifyRegistration() {
    console.log('🏁 Starting Registration E2E Verification...');

    try {
        // 1. Login
        console.log('Step 1: Login');
        const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
            email: 'superadmin@tms.com',
            password: 'admin123'
        });
        const token = loginRes.data.access_token;
        console.log('✅ Login Success');

        const config = { headers: { Authorization: `Bearer ${token}` } };

        // 2. Create Tenant
        console.log('Step 2: Create Tenant');
        const tenantRes = await axios.post(`${BASE_URL}/tenants`, { name: TEST_TENANT }, config);
        const tenantId = tenantRes.data.data.id;
        console.log(`✅ Tenant Created: ${tenantId}`);

        // 3. Invite User
        console.log('Step 3: Invite User');
        const inviteRes = await axios.post(`${BASE_URL}/users/invite`, {
            email: TEST_EMAIL,
            role_name: 'Tenant Admin',
            tenant_id: tenantId
        }, config);
        const inviteToken = inviteRes.data.invite_token;
        console.log(`✅ Invitation Sent: ${TEST_EMAIL}`);

        // 4. Register using the token
        console.log('Step 4: Register User');
        const registerRes = await axios.post(`${BASE_URL}/auth/register-invite`, {
            token: inviteToken,
            password: 'password123',
            first_name: 'Test',
            last_name: 'User',
            mobile: '1234567890'
        });
        console.log('✅ Registration Success Message:', registerRes.data.message);

        // 5. Final Verification in DB
        console.log('Step 5: Verify in Database');
        const { Pool } = require('pg');
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false },
        });

        const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [TEST_EMAIL]);
        if (userRes.rows.length > 0) {
            console.log('✅ User Found in Database!');
            const inviteRes = await pool.query('SELECT status FROM user_invitations WHERE email = $1', [TEST_EMAIL]);
            console.log('✅ Invitation Status:', inviteRes.rows[0].status);
        } else {
            throw new Error('User not found in database after registration!');
        }

        console.log('\n🎉 ALL STEPS PASSED! Registration is 100% working.');
        process.exit(0);

    } catch (error) {
        console.error('❌ E2E VERIFICATION FAILED!');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Error:', error.message);
        }
        process.exit(1);
    }
}

verifyRegistration();
