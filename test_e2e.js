require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function testEndToEnd() {
    try {
        console.log("--- START E2E TEST ---");

        // 0. Get a valid user for created_by
        const userRes = await pool.query('SELECT id FROM users LIMIT 1');
        const userId = userRes.rows[0].id;

        // 1. Generate Raw Token
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(Date.now() + 1000000);

        console.log("Generated Raw Token:", rawToken);
        console.log("Generated Token Hash:", tokenHash);

        // 2. Insert into DB
        await pool.query(`
            INSERT INTO user_invitations 
            (tenant_id, email, role_id, scope_type, scope_id, token_hash, expires_at, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            ['a790b10c-1ab6-4655-9796-d55d8b93b812', 'e2e-test-3@gmail.com', 'ca4ee7d7-98ed-4c80-9091-69ad013ae022', 'tenant', 'a790b10c-1ab6-4655-9796-d55d8b93b812', tokenHash, expiresAt, userId]
        );
        console.log("✅ Inserted into DB.");

        // 3. Simulate Handshake (The part that fails for user)
        const receivedToken = rawToken; // This is what comes in URL
        const lookupHash = crypto.createHash('sha256').update(receivedToken).digest('hex');

        console.log("Handshake Lookup Hash:", lookupHash);

        const res = await pool.query(`
            SELECT ui.email, t.name as company_name
            FROM user_invitations ui
            JOIN tenants t ON ui.tenant_id = t.id
            WHERE ui.token_hash = $1 AND ui.status = 'pending' AND ui.expires_at > NOW()
        `, [lookupHash]);

        if (res.rows.length > 0) {
            console.log("✅ SUCCESS: Handshake found data:", res.rows[0]);
        } else {
            console.log("❌ FAILURE: Handshake found NO data.");
        }

    } catch (err) {
        console.error("E2E ERROR:", err);
    } finally {
        await pool.end();
    }
}

testEndToEnd();
