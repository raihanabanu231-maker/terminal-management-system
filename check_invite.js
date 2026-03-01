require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function checkInvite() {
    try {
        const res = await pool.query("SELECT * FROM user_invitations ORDER BY created_at DESC LIMIT 1");
        if (res.rows.length === 0) {
            console.log("No invitations found.");
        } else {
            const invite = res.rows[0];
            console.log("--- Latest Invitation ---");
            console.log(JSON.stringify(invite, null, 2));
            console.log("\n--- Verification Logic Check ---");
            const dbNow = await pool.query("SELECT NOW()");
            console.log("Database NOW():", dbNow.rows[0].now);
            console.log("Is Expired?:", new Date(invite.expires_at) < new Date(dbNow.rows[0].now));
        }
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkInvite();
