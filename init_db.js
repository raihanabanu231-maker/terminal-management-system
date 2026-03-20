require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDB() {
  const client = await pool.connect();
  try {
    console.log("🚀 Starting Enterprise Database Initialization (Sir Spec)...");

    await client.query("BEGIN");

    // Enable Extensions
    await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
    await client.query(`CREATE EXTENSION IF NOT EXISTS "postgis";`);
    console.log("✅ Extensions enabled.");

    // 1. Tenants
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
    `);

    // 2. Merchants
    await client.query(`
      CREATE TABLE IF NOT EXISTS merchants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        parent_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        external_id TEXT,
        level INTEGER NOT NULL DEFAULT 0,
        path TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
    `);

    // Merchant Path Trigger Function
    await client.query(`
      CREATE OR REPLACE FUNCTION update_merchant_path()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.parent_id IS NULL THEN
          NEW.path = NEW.id::TEXT;
          NEW.level = 0;
        ELSE
          SELECT path || '/' || NEW.id::TEXT, level + 1 
          INTO NEW.path, NEW.level 
          FROM merchants WHERE id = NEW.parent_id;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DROP TRIGGER IF EXISTS trg_merchant_path ON merchants;
      CREATE TRIGGER trg_merchant_path
      BEFORE INSERT OR UPDATE OF parent_id ON merchants
      FOR EACH ROW EXECUTE FUNCTION update_merchant_path();
    `);

    // 3. Device Profiles
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        config JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 4. Devices
    await client.query(`
      CREATE TABLE IF NOT EXISTS devices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        serial TEXT NOT NULL UNIQUE,
        model TEXT NOT NULL,
        manufacturer TEXT,
        os_type TEXT NOT NULL,
        os_version TEXT NOT NULL,
        capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
        profile_id UUID REFERENCES device_profiles(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pending_onboard',
        last_seen TIMESTAMPTZ,
        last_location GEOGRAPHY(POINT, 4326),
        device_token_hash TEXT,
        device_refresh_token_hash TEXT,
        token_version INTEGER NOT NULL DEFAULT 1,
        enrollment_token_used TEXT,
        token_issued_at TIMESTAMPTZ DEFAULT NOW(),
        token_revoked_at TIMESTAMPTZ,
        enrollment_attempts INTEGER DEFAULT 0,
        last_enrollment_attempt TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
    `);

    // 5. Users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        password_hash TEXT,
        first_name TEXT,
        last_name TEXT,
        mobile TEXT,
        invited BOOLEAN NOT NULL DEFAULT false,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        UNIQUE(tenant_id, email)
      );
    `);

    // 6. User Sessions
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        access_jti TEXT NOT NULL UNIQUE,
        refresh_token_hash TEXT NOT NULL,
        access_expires_at TIMESTAMPTZ NOT NULL,
        refresh_expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        ip_address INET,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 7. Roles
    await client.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        permissions TEXT[] NOT NULL DEFAULT '{}',
        deleted_at TIMESTAMPTZ
      );
    `);

    // 8. User Roles
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_roles (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        scope_type TEXT NOT NULL CHECK (scope_type IN ('tenant','merchant')),
        scope_id UUID NOT NULL,
        PRIMARY KEY (user_id, role_id, scope_id)
      );
    `);

    // 9. User Invitations
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_invitations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
        email TEXT NOT NULL,
        role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        scope_type TEXT NOT NULL CHECK (scope_type IN ('tenant', 'merchant')),
        scope_id UUID NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        status TEXT NOT NULL DEFAULT 'pending'
      );
    `);

    // 12. Enrollment Tokens (Jayakumar Spec)
    await client.query(`
      CREATE TABLE IF NOT EXISTS enrollment_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
        device_profile_id UUID,
        token_hash TEXT NOT NULL UNIQUE,
        serial TEXT,
        max_enrollments INTEGER NOT NULL DEFAULT 1,
        remaining_enrollments INTEGER NOT NULL DEFAULT 1,
        expires_at TIMESTAMPTZ NOT NULL,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 11. Device Heartbeats
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_heartbeats (
        device_id UUID PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
        last_seen TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 12. Device Telemetry
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_telemetry (
        device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
        reported_at TIMESTAMPTZ NOT NULL,
        payload JSONB NOT NULL,
        PRIMARY KEY (device_id, reported_at)
      );
    `);

    // 13. Device Rate Limits
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_rate_limits (
        device_id UUID PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
        window_start TIMESTAMPTZ,
        request_count INTEGER DEFAULT 0
      );
    `);

    // 14. Commands
    await client.query(`
      CREATE TABLE IF NOT EXISTS commands (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'queued',
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        expires_at TIMESTAMPTZ,
        sent_at TIMESTAMPTZ,
        acked_at TIMESTAMPTZ,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 15. Artifacts
    await client.query(`
      CREATE TABLE IF NOT EXISTS artifacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('app','firmware')),
        binary_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        approved_by UUID REFERENCES users(id),
        approved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
    `);

    // 16. Deployments (Strategy)
    await client.query(`
      CREATE TABLE IF NOT EXISTS deployments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
        deployment_strategy TEXT DEFAULT 'immediate',
        target_type TEXT NOT NULL CHECK (target_type IN ('device','group','merchant','tenant')),
        target_id UUID NOT NULL,
        rollout_percentage INTEGER NOT NULL DEFAULT 100,
        status TEXT NOT NULL DEFAULT 'pending',
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 16b. Deployment Targets (Per-device tracking)
    await client.query(`
      CREATE TABLE IF NOT EXISTS deployment_targets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
        device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 16c. Deployment Events (Audit log for progress)
    await client.query(`
      CREATE TABLE IF NOT EXISTS deployment_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
        device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        event_payload JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 17. Device Incidents
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_incidents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        first_seen TIMESTAMPTZ NOT NULL,
        resolved_at TIMESTAMPTZ,
        resolution_summary TEXT,
        resolved_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
    `);

    // 18. Incident Events
    await client.query(`
      CREATE TABLE IF NOT EXISTS incident_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_id UUID NOT NULL REFERENCES device_incidents(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}',
        severity TEXT,
        source TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 19. Audit Logs
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id),
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id UUID NOT NULL,
        old_values JSONB,
        new_values JSONB NOT NULL,
        checksum TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 20. Data Retention Policies
    await client.query(`
      CREATE TABLE IF NOT EXISTS data_retention_policies (
        entity TEXT PRIMARY KEY,
        retention_days INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 21. System Metrics Snapshots
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_metrics_snapshots (
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        snapshot_time TIMESTAMPTZ NOT NULL,
        total_devices INTEGER,
        online_devices INTEGER,
        open_incidents INTEGER,
        pending_commands INTEGER,
        PRIMARY KEY (tenant_id, snapshot_time)
      );
    `);

    // 22. Background Jobs
    await client.query(`
      CREATE TABLE IF NOT EXISTS background_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        job_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        run_at TIMESTAMPTZ NOT NULL,
        locked_by TEXT,
        locked_at TIMESTAMPTZ,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Performance Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_merchants_path ON merchants USING btree (path text_pattern_ops);
      CREATE INDEX IF NOT EXISTS idx_devices_serial ON devices(serial);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
      CREATE INDEX IF NOT EXISTS idx_commands_status ON commands(status);
      CREATE INDEX IF NOT EXISTS idx_telemetry_device ON device_telemetry(device_id, reported_at DESC);
    `);

    // Seed Initial Data
    await client.query(`
      INSERT INTO roles (tenant_id, name, permissions)
      VALUES (NULL, 'SUPER_ADMIN', '{*}')
      ON CONFLICT DO NOTHING;
    `);

    await client.query("COMMIT");
    console.log("✅ Enterprise Database Schema Initialized Successfully.");

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error initializing DB:", err);
  } finally {
    client.release();
    pool.end();
  }
}

initDB();
