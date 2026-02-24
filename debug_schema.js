
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    try {
        const r1 = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'user_roles'
        `);
        console.log("USER_ROLES_SCHEMA:", JSON.stringify(r1.rows, null, 2));

        const r2 = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'user_invitations'
        `);
        console.log("USER_INVITATIONS_SCHEMA:", JSON.stringify(r2.rows, null, 2));
    } finally {
        await pool.end();
    }
}
run();
