require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function debugInvites() {
    try {
        console.log("--- START DATABASE DEBUG ---");
        const res = await pool.query(`
            SELECT id, email, token_hash, status, expires_at 
            FROM user_invitations 
            ORDER BY created_at DESC 
            LIMIT 5
        `);

        res.rows.forEach((row, i) => {
            console.log(`Invite ${i + 1}:`);
            console.log(`  Email: ${row.email}`);
            console.log(`  Status: ${row.status}`);
            console.log(`  Hash in DB: ${row.token_hash}`);
            console.log(`  Expires: ${row.expires_at}`);
            console.log("----------------------------");
        });

        // Let's test the screenshot token manually
        const screenToken = "d8b10b448e750dbc6c3136856076072f56cc991907db80b3ddc641bd43";
        const screenHash = crypto.createHash('sha256').update(screenToken).digest('hex');
        console.log(`Screenshot Token Hash would be: ${screenHash}`);

        const match = res.rows.find(r => r.token_hash === screenHash);
        if (match) {
            console.log("✅ MATCH FOUND IN LATEST 5!");
        } else {
            console.log("❌ NO MATCH FOR SCREENSHOT TOKEN IN LATEST 5.");
        }

    } catch (err) {
        console.error("DEBUG ERROR:", err);
    } finally {
        await pool.end();
    }
}

debugInvites();
