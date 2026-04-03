require("dotenv").config();
const pool = require('./src/config/db');

async function diag() {
    try {
        console.log("🔍 Checking DB Connection...");
        const result = await pool.query("SELECT * FROM device_log_sessions LIMIT 1");
        console.log("✅ Success! device_log_sessions table exists.");
        console.log("Columns:", result.fields.map(f => f.name).join(', '));
    } catch (e) {
        console.error("❌ DB Check Failed:", e.message);
    } finally {
        process.exit(0);
    }
}

diag();
