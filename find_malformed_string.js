require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function findMalformedString() {
    const searchStr = '1b404d23e-94a5-4a69-8302-4a5c3991e8cf';
    const tables = ['users', 'tenants', 'roles', 'user_invitations', 'user_roles'];

    console.log(`🔍 Searching for malformed string: [${searchStr}]`);

    for (const table of tables) {
        try {
            const res = await pool.query(`SELECT * FROM ${table}`);
            const matches = res.rows.filter(row => JSON.stringify(row).includes(searchStr));
            if (matches.length > 0) {
                console.log(`✅ MATCH FOUND in ${table}:`);
                console.log(JSON.stringify(matches, null, 2));
            }
        } catch (err) {
            console.error(`Error searching ${table}:`, err.message);
        }
    }
    await pool.end();
}

findMalformedString();
