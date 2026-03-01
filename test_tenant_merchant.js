require('dotenv').config();
const axios = require('axios');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
    try {
        const res = await pool.query("SELECT u.email FROM users u JOIN user_roles ur ON u.id = ur.user_id JOIN roles r ON ur.role_id = r.id WHERE r.name = 'Tenant Admin' ORDER BY u.created_at DESC LIMIT 1");
        if (res.rows.length === 0) throw new Error('No tenant admin found in DB');
        const email = res.rows[0].email;
        console.log('Test Email:', email);

        const login = await axios.post('http://localhost:' + (process.env.PORT || 8080) + '/api/v1/auth/login', { email: email, password: 'Password123!' });
        const token = login.data.access_token;
        console.log('Login Role:', login.data.user.role);

        const create = await axios.post('http://localhost:' + (process.env.PORT || 8080) + '/api/v1/merchants', { name: 'Test Store' }, { headers: { Authorization: 'Bearer ' + token }, validateStatus: () => true });
        console.log('API Status:', create.status);
        console.log('API Response:', JSON.stringify(create.data, null, 2));

    } catch (e) {
        if (e.response) {
            console.error('API Error:', JSON.stringify(e.response.data, null, 2));
        } else {
            console.error('Network Error:', e.message);
        }
    } finally {
        pool.end();
    }
}
run();
