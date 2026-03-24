require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function fix() {
  try {
    console.log("🛠️ Attempting to add missing 'serial' column to enrollment_tokens...");
    await pool.query("ALTER TABLE enrollment_tokens ADD COLUMN IF NOT EXISTS serial TEXT");
    console.log("✅ Column added successfully!");
    process.exit(0);
  } catch (e) {
    console.error("❌ Error adding column:", e.message);
    process.exit(1);
  }
}
fix();
