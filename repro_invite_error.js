require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function testInvite() {
    const adminEmail = 'superadmin@tms.com';

    try {
        // 1. Get Admin ID
        const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
        if (userRes.rows.length === 0) {
            console.error(`❌ Admin ${adminEmail} not found!`);
            return;
        }
        const adminId = userRes.rows[0].id;
        console.log(`✅ Admin ID: ${adminId}`);

        // 2. Get a valid role (Global Role)
        const roleRes = await pool.query("SELECT id FROM roles WHERE name = 'Super Admin' LIMIT 1");
        if (roleRes.rows.length === 0) {
            console.error('❌ Super Admin role not found!');
            return;
        }
        const roleId = roleRes.rows[0].id;

        // 3. Try Insert
        const dummyTokenHash = 'test-' + Date.now();
        const expiresAt = new Date(Date.now() + 100000);

        console.log('⏳ Attempting INSERT into user_invitations...');
        await pool.query(
            `INSERT INTO user_invitations 
       (tenant_id, merchant_id, email, role_id, scope_type, scope_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [null, null, 'test@example.com', roleId, 'tenant', adminId, dummyTokenHash, expiresAt, adminId]
        );
        console.log('✅ INSERT successful!');

    } catch (err) {
        console.error('❌ INSERT failed:');
        console.error(err.message);
        if (err.detail) console.error('Detail:', err.detail);
    } finally {
        await pool.end();
    }
}

testInvite();
