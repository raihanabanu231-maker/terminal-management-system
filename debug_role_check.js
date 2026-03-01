require('dotenv').config();
const axios = require('axios');
const jwt = require('jsonwebtoken');

async function run() {
    try {
        const token = jwt.sign({ id: '111', tenant_id: '222', role: 'TENANT_ADMIN' }, process.env.JWT_SECRET || 'fallback_secret');
        const res = await axios.get('http://localhost:' + (process.env.PORT || 8080) + '/api/v1/merchants/debug', { headers: { Authorization: 'Bearer ' + token }, validateStatus: () => true });
        console.log('STATUS:', res.status);
        console.log('DATA:', JSON.stringify(res.data, null, 2));
    } catch (e) {
        console.error('ERROR:', e.message);
    }
}
run();
