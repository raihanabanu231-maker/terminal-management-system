require('dotenv').config();
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
    try {
        const res = await pool.query("SELECT u.id, u.tenant_id, u.email, r.name as role_name, ur.role_id, ur.scope_type FROM users u JOIN user_roles ur ON u.id = ur.user_id JOIN roles r ON ur.role_id = r.id WHERE r.name = 'Tenant Admin' ORDER BY u.created_at DESC LIMIT 1");
        if (res.rows.length === 0) throw new Error('No tenant admin found in DB');
        const user = res.rows[0];
        console.log('Simulating User:', user.email);

        const payload = {
            id: user.id,
            tenant_id: user.tenant_id,
            jti: "fake_jti_debug",
            roles: [{ name: user.role_name, id: user.role_id, scope: user.scope_type }],
            role: user.role_name.toUpperCase().replace(/\s+/g, "_")
        };

        const token = jwt.sign(payload, process.env.JWT_SECRET || "fallback_secret", { expiresIn: '1h' });
        console.log('JWT Role Issued:', payload.role);

        const create = await axios.post('http://localhost:' + (process.env.PORT || 8080) + '/api/v1/merchants', { name: 'Test Store' }, { headers: { Authorization: 'Bearer ' + token }, validateStatus: () => true });
        console.log('API Status:', create.status);
        console.log('API Response:', JSON.stringify(create.data, null, 2));

    } catch (e) {
        console.error('Script Error:', e.response ? e.response.data : e.message);
    } finally {
        pool.end();
    }
}
run();
