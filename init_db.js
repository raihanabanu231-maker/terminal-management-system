require("dotenv").config();
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDB() {
  const client = await pool.connect();
  try {
    console.log("🚀 Starting Production Database Initialization...");

    // ⚠️ Tables will only be created if they do not exist (IF NOT EXISTS)
    console.log("🛠️ Ensuring all tables exist...");

    await client.query("BEGIN");

    // Enable Extensions
    await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
    await client.query(`CREATE EXTENSION IF NOT EXISTS "postgis";`);
    console.log("✅ Extensions enabled (pgcrypto, postgis).");

    // 1. Tenants Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Merchants Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS merchants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        parent_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        external_id TEXT,
        level INTEGER NOT NULL DEFAULT 0,
        path TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Merchant Path Trigger Function (Week 1 Core Logic)
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

    // 3. Users Table
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

    // 4. User Sessions
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        jti TEXT NOT NULL UNIQUE,
        ip_address INET,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        invalidated_at TIMESTAMPTZ
      );
    `);

    // 5. Roles
    await client.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        permissions TEXT[] NOT NULL DEFAULT '{}'
      );
    `);

    // 6. User Roles
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_roles (
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        scope_type TEXT NOT NULL CHECK (scope_type IN ('tenant', 'merchant')),
        scope_id UUID NOT NULL,
        PRIMARY KEY (user_id, role_id, scope_id)
      );
    `);

    // 7. User Invitations
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

    // 8. Device Enrollment Tokens
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_enrollment_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 8. Entitlements
    await client.query(`
      CREATE TABLE IF NOT EXISTS entitlements (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT
      );
    `);

    // 9. Tenant Entitlements
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenant_entitlements (
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        entitlement_id TEXT NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
        enabled BOOLEAN NOT NULL DEFAULT false,
        source TEXT NOT NULL DEFAULT 'manual',
        expires_at TIMESTAMPTZ,
        PRIMARY KEY (tenant_id, entitlement_id)
      );
    `);

    // 10. Device Profiles
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        config JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 11. Devices
    await client.query(`
      CREATE TABLE IF NOT EXISTS devices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        serial TEXT NOT NULL UNIQUE,
        model TEXT NOT NULL,
        manufacturer TEXT,
        os_type TEXT NOT NULL DEFAULT 'android',
        os_version TEXT NOT NULL DEFAULT 'unknown',
        capabilities JSONB NOT NULL DEFAULT '{}',
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
        deleted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 12. Device Groups
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_groups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 13. Group Devices
    await client.query(`
      CREATE TABLE IF NOT EXISTS group_devices (
        group_id UUID NOT NULL REFERENCES device_groups(id) ON DELETE CASCADE,
        device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        PRIMARY KEY (group_id, device_id)
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
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 16. Device Incidents
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
        resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
        ai_suggestion_used BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 17. Incident Events
    await client.query(`
      CREATE TABLE IF NOT EXISTS incident_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_id UUID NOT NULL REFERENCES device_incidents(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 18. Device Telemetry
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_telemetry (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        cpu_usage NUMERIC,
        ram_usage NUMERIC,
        battery_level NUMERIC,
        storage_usage NUMERIC,
        custom_data JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 18.5 Device Heartbeats
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_heartbeats (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        battery_level INTEGER,
        app_version TEXT,
        network_type TEXT,
        metadata JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 19. Audit Logs
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id UUID NOT NULL,
        old_values JSONB,
        new_values JSONB NOT NULL,
        checksum TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 19. Data Deletion Requests
    await client.query(`
      CREATE TABLE IF NOT EXISTS data_deletion_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        requester_id UUID NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'pending',
        requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
    `);

    // Performance Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_merchants_path ON merchants USING btree (path text_pattern_ops);
      CREATE INDEX IF NOT EXISTS idx_devices_serial ON devices(serial);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
      CREATE INDEX IF NOT EXISTS idx_commands_device_id ON commands(device_id, status);
      CREATE INDEX IF NOT EXISTS idx_telemetry_device_id ON device_telemetry(device_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_incidents_tenant_id ON device_incidents(tenant_id, status);
    `);

    // --- Week 2 Spec Tables (Jayakumar Architecture) ---

    // 20. Enrollment Tokens (Reusable, multi-device tokens)
    await client.query(`
      CREATE TABLE IF NOT EXISTS enrollment_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
        device_profile_id UUID REFERENCES device_profiles(id) ON DELETE SET NULL,
        token_hash TEXT NOT NULL UNIQUE,
        max_enrollments INTEGER NOT NULL DEFAULT 1,
        remaining_enrollments INTEGER NOT NULL DEFAULT 1,
        expires_at TIMESTAMPTZ NOT NULL,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 21. Device Tokens (Separate token lifecycle tracking)
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ
      );
    `);

    // 22. Device Rate Limits (Per-device flood protection)
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_rate_limits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(device_id, endpoint)
      );
    `);

    // Add device_status column if not exists (ONLINE, DEGRADED, OFFLINE)
    await client.query(`
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_status TEXT NOT NULL DEFAULT 'offline';
    `);

    // Add storage_free_mb and agent_version to heartbeats if not exists
    await client.query(`
      ALTER TABLE device_heartbeats ADD COLUMN IF NOT EXISTS storage_free_mb INTEGER;
    `);

    // Add execution_time_ms to commands if not exists
    await client.query(`
      ALTER TABLE commands ADD COLUMN IF NOT EXISTS execution_time_ms INTEGER;
    `);

    // Week 2 Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_hash ON enrollment_tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_device_tokens_hash ON device_tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_device_tokens_device ON device_tokens(device_id);
      CREATE INDEX IF NOT EXISTS idx_device_rate_limits ON device_rate_limits(device_id, endpoint);
      CREATE INDEX IF NOT EXISTS idx_commands_status_expires ON commands(status, expires_at);
      CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen, status);
    `);

    // --- Artifact Management System (Jayakumar Spec) ---

    // 23. Artifacts (APKs, firmware, configs, patches)
    await client.query(`
      CREATE TABLE IF NOT EXISTS artifacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        file_url TEXT NOT NULL,
        file_hash TEXT,
        file_size BIGINT,
        min_device_version TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        approved_by UUID REFERENCES users(id),
        approved_at TIMESTAMPTZ,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ
      );
    `);

    // 24. Artifact Approvals (PCI / Enterprise Audit Compliance)
    await client.query(`
      CREATE TABLE IF NOT EXISTS artifact_approvals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
        approved_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        notes TEXT
      );
    `);

    // --- Deployment Engine (Jayakumar Spec) ---

    // 25. Deployments
    await client.query(`
      CREATE TABLE IF NOT EXISTS deployments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
        deployment_strategy TEXT NOT NULL DEFAULT 'immediate',
        target_type TEXT NOT NULL CHECK (target_type IN ('device', 'group', 'merchant', 'tenant', 'device_group')),
        target_id UUID NOT NULL,
        rollout_percentage INTEGER NOT NULL DEFAULT 100,
        status TEXT NOT NULL DEFAULT 'pending',
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 26. Deployment Targets (individual device tracking)
    await client.query(`
      CREATE TABLE IF NOT EXISTS deployment_targets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
        device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 27. Deployment Events (device progress tracking)
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

    // FINAL CONSOLIDATED SCHEMA MIGRATION (Clean and Safe)
    await client.query(`
      -- 1. Devices: metadata and scale columns
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS manufacturer TEXT;
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS os_type TEXT NOT NULL DEFAULT 'android';
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS os_version TEXT NOT NULL DEFAULT 'unknown';
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '{}';
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS enrollment_attempts INTEGER DEFAULT 0;
      ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_enrollment_attempt TIMESTAMPTZ;

      -- 2. Artifacts: Structural alignment (Sir Flow)
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='artifacts' AND column_name='type') 
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='artifacts' AND column_name='artifact_type') THEN
          ALTER TABLE artifacts RENAME COLUMN type TO artifact_type;
        END IF;
        
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='artifacts' AND column_name='binary_path') 
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='artifacts' AND column_name='file_url') THEN
          ALTER TABLE artifacts RENAME COLUMN binary_path TO file_url;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='artifacts' AND column_name='file_url') THEN
           ALTER TABLE artifacts ALTER COLUMN file_url DROP NOT NULL;
        END IF;
      END $$;
      ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS file_hash TEXT;
      ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS file_size BIGINT;
      ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS min_device_version TEXT;
      ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
      ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

      -- 3. Deployments: Table renaming and tracking (Sir Flow)
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='artifact_deployments') AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='deployments') THEN
          ALTER TABLE artifact_deployments RENAME TO deployments;
        END IF;
      END $$;
      ALTER TABLE deployments ADD COLUMN IF NOT EXISTS deployment_strategy TEXT DEFAULT 'immediate';
      ALTER TABLE deployments ADD COLUMN IF NOT EXISTS rollout_percentage INTEGER DEFAULT 100;

      -- 4. Audit & Reliability
      ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS checksum TEXT;
      ALTER TABLE commands ADD COLUMN IF NOT EXISTS last_error TEXT;

      -- 5. Helper Tables (Heartbeats, Metrics, Jobs)
      CREATE TABLE IF NOT EXISTS device_heartbeats (
        device_id UUID PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
        last_seen TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS data_retention_policies (
        entity TEXT PRIMARY KEY,
        retention_days INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS system_metrics_snapshots (
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        snapshot_time TIMESTAMPTZ NOT NULL,
        total_devices INTEGER,
        online_devices INTEGER,
        open_incidents INTEGER,
        pending_commands INTEGER,
        PRIMARY KEY (tenant_id, snapshot_time)
      );

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

    // Artifact + Deployment Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_artifacts_tenant ON artifacts(tenant_id, status);
      CREATE INDEX IF NOT EXISTS idx_artifact_approvals ON artifact_approvals(artifact_id);
      CREATE INDEX IF NOT EXISTS idx_deployments_tenant ON deployments(tenant_id, status);
      CREATE INDEX IF NOT EXISTS idx_deployment_targets_deploy ON deployment_targets(deployment_id, status);
      CREATE INDEX IF NOT EXISTS idx_deployment_targets_device ON deployment_targets(device_id, status);
      CREATE INDEX IF NOT EXISTS idx_deployment_events ON deployment_events(deployment_id, device_id);
    `);

    // Seed Initial Roles (System Level)
    await client.query(`
      INSERT INTO roles (tenant_id, name, permissions)
      VALUES 
        (NULL, 'Super Admin', '{*}'),
        (NULL, 'Tenant Admin', '{tenant.*, merchant.*, device.*}'),
        (NULL, 'Operator', '{device.view, device.command}')
      ON CONFLICT DO NOTHING;
    `);

    // Seed Initial Entitlements
    await client.query(`
      INSERT INTO entitlements (id, name, description)
      VALUES 
        ('device_groups', 'Device Groups', 'Allows logical grouping of devices'),
        ('remote_view', 'Remote View', 'Allows real-time remote screen viewing'),
        ('app_deployment', 'App Deployment', 'Allows pushing APKs to devices')
      ON CONFLICT (id) DO NOTHING;
    `);

    await client.query("COMMIT");
    console.log("✅ Database Schema Initialized Successfully.");

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error initializing DB:", err);
  } finally {
    client.release();
    pool.end();
  }
}

initDB();
