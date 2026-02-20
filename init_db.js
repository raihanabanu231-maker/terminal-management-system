require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDB() {
  try {
    console.log("Initializing Database...");

    // 1. Tenants Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Checked/Created 'tenants' table.");

    // 2. Merchants Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS merchants (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        tenant_id INTEGER REFERENCES tenants(id),
        parent_id INTEGER REFERENCES merchants(id),
        path TEXT,
        level INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Checked/Created 'merchants' table.");

    // 3. User Invitations Table (New for Flow 1 & 2)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_invitations (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        tenant_id INTEGER REFERENCES tenants(id),
        scope_merchant_id INTEGER REFERENCES merchants(id),
        token VARCHAR(255) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        accepted_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Checked/Created 'user_invitations' table.");

    // 4. Users Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255),
        role VARCHAR(50) NOT NULL,
        tenant_id INTEGER REFERENCES tenants(id),
        merchant_id INTEGER REFERENCES merchants(id),
        status VARCHAR(20) DEFAULT 'ACTIVE',
        invite_token VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Checked/Created 'users' table.");

    // 5. Devices Table (Updated for Flow 3)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS devices (
        id SERIAL PRIMARY KEY,
        serial_number VARCHAR(255) UNIQUE NOT NULL,
        status VARCHAR(50) DEFAULT 'PENDING',
        enrollment_token VARCHAR(255),
        enrollment_token_expires TIMESTAMP,
        device_token_hash VARCHAR(255),
        merchant_id INTEGER REFERENCES merchants(id),
        tenant_id INTEGER REFERENCES tenants(id),
        last_seen TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add columns if they don't exist (for existing tables)
    await pool.query(`
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS enrollment_token VARCHAR(255);
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS enrollment_token_expires TIMESTAMP;
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_token_hash VARCHAR(255);
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP;
    `);

    console.log("Checked/Created 'devices' table.");

    // 6. Commands Table (For Flow 5)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS commands (
        id SERIAL PRIMARY KEY,
        device_id INTEGER REFERENCES devices(id),
        command_type VARCHAR(50) NOT NULL,
        payload JSONB,
        status VARCHAR(50) DEFAULT 'QUEUED',
        sent_at TIMESTAMP,
        acked_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Checked/Created 'commands' table.");

    // 7. Artifacts Table (For Flow 6: App/Firmware Deployment)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS artifacts (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id),
        name VARCHAR(255) NOT NULL,
        version VARCHAR(50) NOT NULL,
        binary_path VARCHAR(500) NOT NULL,
        status VARCHAR(50) DEFAULT 'DRAFT',
        created_by INTEGER REFERENCES users(id),
        approved_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        published_at TIMESTAMP
      );
    `);
    console.log("Checked/Created 'artifacts' table.");

    // 8. Audit Logs Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        action VARCHAR(100) NOT NULL,
        actor_id INTEGER REFERENCES users(id),
        target_id VARCHAR(50),
        target_type VARCHAR(50),
        details JSONB,
        ip_address VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Checked/Created 'audit_logs' table.");

    console.log("Database Initialization Complete.");
    pool.end();
  } catch (err) {
    console.error("Error initializing DB:", err);
    pool.end();
  }
}

initDB();
