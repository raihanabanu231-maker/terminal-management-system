require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function checkSchema() {
    try {
        const colRes = await pool.query(`
      SELECT column_name, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'tenant_id'
    `);
        console.log('--- Users Table tenant_id Constraint ---');
        console.log(JSON.stringify(colRes.rows, null, 2));

        const userRes = await pool.query(`
      SELECT id, email, tenant_id 
      FROM users 
      WHERE email = 'superadmin@tms.com'
    `);
        console.log('--- Super Admin Record ---');
        console.log(JSON.stringify(userRes.rows, null, 2));

        const tenantRes = await pool.query(`SELECT id, name FROM tenants`);
        console.log('--- Current Tenants ---');
        console.log(JSON.stringify(tenantRes.rows, null, 2));

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkSchema();
