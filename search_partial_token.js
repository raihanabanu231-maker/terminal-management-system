require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function findPartialMatch() {
    // This is the 58-char token from the screenshot
    const searchToken = 'd8b10b448e750dbc6c3136856076072f56cc991907db80b3ddc641bd43';

    try {
        console.log(`Searching for any hash containing the substring: ${searchToken}`);
        const res = await pool.query(`
            SELECT email, token_hash, status, created_at 
            FROM user_invitations 
            WHERE token_hash LIKE $1
        `, [`%${searchToken}%`]);

        if (res.rows.length > 0) {
            console.log("✅ PARTIAL MATCH FOUND!");
            console.log(JSON.stringify(res.rows, null, 2));
        } else {
            console.log("❌ NO PARTIAL MATCH FOUND.");

            // Let's also search for tokens that MIGHT have been saved as raw instead of hash
            // (Just in case an old version of the code was doing that)
            console.log("\nSearching for screenshot string in any column...");
            const broad = await pool.query(`SELECT * FROM user_invitations`);
            const matched = broad.rows.filter(r => JSON.stringify(r).includes(searchToken));

            if (matched.length > 0) {
                console.log("✅ MATCHED STRING IN ROW DATA!");
                console.log(JSON.stringify(matched, null, 2));
            } else {
                console.log("❌ STRING NOT FOUND ANYWHERE IN TABLE.");
            }
        }
    } catch (err) {
        console.error("SEARCH ERROR:", err);
    } finally {
        await pool.end();
    }
}

findPartialMatch();
