require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

const token = 'fe9e484a3bb06318fedde0609bc756cb6a855156df61eca0fe0a35a307e16583';
const hash = crypto.createHash('sha256').update(token.trim()).digest('hex');

async function check() {
    console.log('Token:', token);
    console.log('Hash:', hash);
    try {
        const res = await pool.query('SELECT email, status, expires_at FROM user_invitations WHERE token_hash = $1', [hash]);
        console.log('Matches Found:', JSON.stringify(res.rows, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

check();
