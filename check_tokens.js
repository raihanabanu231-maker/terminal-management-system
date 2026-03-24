require('dotenv').config();
const pool = require('./src/config/db');

async function check() {
  try {
    const res = await pool.query("SELECT id, serial, max_enrollments, remaining_enrollments, created_at FROM enrollment_tokens ORDER BY created_at DESC LIMIT 5");
    console.log("=== LATEST ENROLLMENT TOKENS ===");
    console.table(res.rows);
    process.exit(0);
  } catch (e) {
    console.error("❌ SQL Error:", e.message);
    process.exit(1);
  }
}
check();
