require("dotenv").config();
const pool = require("./src/config/db");

async function checkSchema() {
    try {
        const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
        console.log("Tables:", res.rows.map(r => r.table_name));
        pool.end();
    } catch (err) {
        console.error(err);
    }
}

checkSchema();
