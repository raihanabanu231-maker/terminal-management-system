require("dotenv").config();
const { Pool } = require("pg");
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function findIds() {
    try {
        const tenants = await pool.query("SELECT id, name FROM tenants");
        const roles = await pool.query("SELECT id, name FROM roles");
        const users = await pool.query("SELECT id, email FROM users WHERE email = 'superadmin@tms.com'");

        console.log("--- TENANTS ---");
        console.log(JSON.stringify(tenants.rows, null, 2));
        console.log("--- ROLES ---");
        console.log(JSON.stringify(roles.rows, null, 2));
        console.log("--- SUPERADMIN ---");
        console.log(JSON.stringify(users.rows, null, 2));

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

findIds();
