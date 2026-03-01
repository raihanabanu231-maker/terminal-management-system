require('dotenv').config();
const { Pool } = require('pg');
const axios = require('axios');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const BACKEND_URL = 'https://tms-backend-atpl-2vr9.onrender.com/api/v1';

async function testLiveHandshake() {
    try {
        // 1. Find a pending token that should work (we need the RAW token though)
        // Since we can't get the raw token from the hash, we'll look for recent logs or just use the one we just created in verify_full_flow if it's still there
        console.log("🔍 Looking for recent pending invites...");
        const res = await pool.query("SELECT * FROM user_invitations WHERE status = 'pending' ORDER BY created_at DESC LIMIT 5");

        if (res.rows.length === 0) {
            console.log("❌ No pending invites found to test.");
            return;
        }

        console.table(res.rows.map(r => ({ email: r.email, token_hash: r.token_hash })));

        // Since we don't have the RAW token, we can't test the handshake normally.
        // BUT we can test the handshake endpoint by passing the HASH directly (it will hash it again and return 400, but it should NOT return 500)
        console.log("\n🧪 Testing handshake with a dummy token to check for 500s...");
        try {
            const handshake = await axios.get(`${BACKEND_URL}/auth/invite?token=dummy_token_123`);
            console.log("Handshake Result:", handshake.data);
        } catch (err) {
            console.log("Handshake Error (Expected 400, not 500):", err.response ? err.response.status : err.message);
            if (err.response && err.response.status === 500) {
                console.log("🚨 DETECTED 500 ERROR!");
                console.log(JSON.stringify(err.response.data, null, 2));
            }
        }

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
testLiveHandshake();
