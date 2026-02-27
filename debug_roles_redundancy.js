
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function run() {
    try {
        console.log("--- Roles Table Columns ---");
        const columns = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'roles'
      ORDER BY ordinal_position
    `);
        console.table(columns.rows);

        console.log("\n--- Unique Constraints & Primary Keys ---");
        const constraints = await pool.query(`
      SELECT conname, pg_get_constraintdef(c.oid)
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE conrelid = 'roles'::regclass
    `);
        console.table(constraints.rows);

        console.log("\n--- Actual Rows for 'Super Admin' ---");
        const rows = await pool.query(`
      SELECT id, tenant_id, name, permissions FROM roles WHERE name = 'Super Admin'
    `);
        console.table(rows.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

run();
