require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});
async function run() {
    try {
        const res = await pool.query("SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'user_invitations' AND column_name = 'tenant_id'");
        console.log("Schema for user_invitations.tenant_id:", JSON.stringify(res.rows[0], null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
