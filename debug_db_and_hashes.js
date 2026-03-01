require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkDatabase() {
    try {
        const dbInfo = await pool.query("SELECT current_database(), current_user, inet_server_addr()");
        console.log("Database Info:", JSON.stringify(dbInfo.rows[0], null, 2));

        const res = await pool.query("SELECT email, token_hash, created_at FROM user_invitations ORDER BY created_at DESC LIMIT 10");
        console.log("Recent Invitations:");
        res.rows.forEach(row => {
            console.log(`- ${row.email} | Hash: ${row.token_hash} | Created: ${row.created_at}`);
        });

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkDatabase();
