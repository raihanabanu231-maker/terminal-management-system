
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function findYesterdayUsers() {
    try {
        const query = `
            SELECT email, created_at, status 
            FROM users 
            WHERE created_at >= '2026-02-24' 
            ORDER BY created_at DESC
        `;
        const res = await pool.query(query);
        console.log("USERS_CREATED_SINCE_YESTERDAY:", JSON.stringify(res.rows, null, 2));

        const inviteQuery = `
            SELECT email, status, created_at, merchant_id 
            FROM user_invitations 
            WHERE created_at >= '2026-02-24'
            ORDER BY created_at DESC
        `;
        const inviteRes = await pool.query(inviteQuery);
        console.log("INVITES_CREATED_SINCE_YESTERDAY:", JSON.stringify(inviteRes.rows, null, 2));

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

findYesterdayUsers();
