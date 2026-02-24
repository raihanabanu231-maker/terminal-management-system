
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        const r = await pool.query(`
            SELECT email, merchant_id, scope_type, scope_id 
            FROM user_invitations 
            ORDER BY created_at DESC 
            LIMIT 5
        `);
        console.log("RECENT_INVITATIONS:", JSON.stringify(r.rows, null, 2));
    } finally {
        await pool.end();
    }
}
run();
