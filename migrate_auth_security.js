
require('dotenv').config();
const pool = require('./src/config/db');

async function migrate() {
    console.log("🚀 Starting Auth Security Migration...");

    try {
        // 1. Add lockouts/security columns to users
        await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS failed_attempts INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE;
    `);
        console.log("✅ Added failed_attempts and locked_until to users table.");

        // 2. We can use user_sessions table for refresh tokens
        // It already has user_id, jti, ip_address, user_agent, invalidated_at.
        // This is perfect for the guide's recommendation.

        console.log("🎉 Migration complete!");
    } catch (err) {
        console.error("❌ Migration failed:", err);
    } finally {
        process.exit(0);
    }
}

migrate();
