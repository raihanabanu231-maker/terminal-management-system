require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

const fs = require('fs');

async function runDiagnostics() {
    let output = "";
    const log = (msg) => { output += msg + "\n"; console.log(msg); };

    try {
        log("--- Users in DB ---");
        const users = await pool.query('SELECT id, email, tenant_id FROM users');
        output += JSON.stringify(users.rows, null, 2) + "\n";

        log("\n--- User Invitations Constraints ---");
        const constraints = await pool.query(`
      SELECT
          tc.constraint_name, 
          kcu.column_name, 
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name 
      FROM 
          information_schema.table_constraints AS tc 
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name='user_invitations';
    `);
        output += JSON.stringify(constraints.rows, null, 2) + "\n";

        log("\n--- Table structure for user_invitations ---");
        const columns = await pool.query("SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_name = 'user_invitations'");
        output += JSON.stringify(columns.rows, null, 2) + "\n";

        fs.writeFileSync('diagnose_results.json', output);
        console.log("✅ Results saved to diagnose_results.json");

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

runDiagnostics();
