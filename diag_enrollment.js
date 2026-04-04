const pool = require("./src/config/db");

async function check() {
    try {
        const res = await pool.query(\`
            SELECT table_name, column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'enrollment_tokens'
        \`);
        console.table(res.rows);
    } catch (err) {
        console.error("ERROR:", err.message);
    } finally {
        process.exit();
    }
}
check();
