require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkHealth() {
  try {
    const res = await pool.query("SELECT NOW() as time, current_database() as db");
    console.log("✅ DB IS HEALTHY!");
    console.log("Current Time:", res.rows[0].time);
    console.log("Connected to DB:", res.rows[0].db);
    
    const tenants = await pool.query("SELECT count(*) FROM tenants");
    console.log("Total Tenants in DB:", tenants.rows[0].count);
    
    process.exit(0);
  } catch (error) {
    console.error("❌ DB CONNECTION FAILED!");
    console.error(error.message);
    process.exit(1);
  }
}

checkHealth();
