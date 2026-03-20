const pool = require("../../config/db");
const { logAudit } = require("../../utils/audit");

/**
 * DEPLOYMENT ENGINE - STAGE 2 & 3: STRATEGY & EXECUTION (SIR SPEC)
 * 1. Admin creates a Campaign (Deployment Strategy).
 * 2. Background Resolver expands merchant/tenant targets to single devices.
 * 3. Background Executor marks devices for INSTALL_ARTIFACT commands.
 */

// 1. Create Deployment (Step 1)
exports.createDeployment = async (req, res) => {
    const { artifact_id, target_type, target_id, rollout_percentage } = req.body;

    if (!artifact_id || !target_type || !target_id) {
        return res.status(400).json({ success: false, message: "artifact_id, target_type, and target_id are required." });
    }

    const tenantId = req.user.role === "SUPER_ADMIN" ? (req.body.tenant_id || req.user.tenant_id) : req.user.tenant_id;

    try {
        // 1. Verify Artifact is Approved
        const artifactRes = await pool.query(
            "SELECT * FROM artifacts WHERE id = $1 AND status = 'approved' AND deleted_at IS NULL",
            [artifact_id]
        );

        if (artifactRes.rows.length === 0) {
            return res.status(400).json({ success: false, message: "Only APPROVED artifacts can be deployed to devices." });
        }

        const artifact = artifactRes.rows[0];

        // 2. Create the Deployment Campaign record
        const result = await pool.query(
            `INSERT INTO deployments (tenant_id, artifact_id, target_type, target_id, rollout_percentage, status, created_by)
             VALUES ($1, $2, $3, $4, $5, 'pending', $6)
             RETURNING id`,
            [tenantId, artifact_id, target_type, target_id, rollout_percentage || 100, req.user.id]
        );

        const deploymentId = result.rows[0].id;

        // 3. Resolve Targets (Find all devices belonging to this target)
        await resolveDeploymentTargets(deploymentId, target_type, target_id, tenantId, rollout_percentage || 100);

        await logAudit(tenantId, req.user.id, "DEPLOYMENT_STARTED", "DEPLOYMENT", deploymentId, {
            artifact: artifact.name,
            version: artifact.version,
            target: target_type
        });

        res.status(201).json({
            success: true,
            message: "Deployment strategy created. Background resolution is complete.",
            deployment_id: deploymentId
        });

    } catch (error) {
        console.error("CREATE_DEPLOYMENT_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error", detail: error.message });
    }
};

// Internal Helper: Target Resolver (Step 2)
async function resolveDeploymentTargets(deploymentId, target_type, target_id, tenant_id, rollout) {
    let devices = [];

    if (target_type === 'device') {
        const res = await pool.query("SELECT id FROM devices WHERE id = $1 AND status = 'active'", [target_id]);
        devices = res.rows;
    } else if (target_type === 'merchant') {
        // Find devices in this merchant OR any child merchant (if hierarchy exists)
        const res = await pool.query(
            `SELECT d.id FROM devices d
             JOIN merchants m ON d.merchant_id = m.id
             WHERE (m.id = $1 OR m.path LIKE '%' || $1::text || '%')
             AND d.status = 'active'`,
            [target_id]
        );
        devices = res.rows;
    } else if (target_type === 'tenant') {
        const res = await pool.query("SELECT id FROM devices WHERE tenant_id = $1 AND status = 'active'", [target_id]);
        devices = res.rows;
    } else {
        // Default to all active devices in tenant
        const res = await pool.query("SELECT id FROM devices WHERE tenant_id = $1 AND status = 'active'", [tenant_id]);
        devices = res.rows;
    }

    // Apply Rollout Percentage
    if (rollout < 100 && devices.length > 0) {
        const targetCount = Math.ceil(devices.length * (rollout / 100));
        devices = devices.sort(() => Math.random() - 0.5).slice(0, targetCount);
    }

    // Insert 1 row per device into deployment_targets (The per-device progress bar)
    for (const dev of devices) {
        await pool.query(
            "INSERT INTO deployment_targets (deployment_id, device_id, status) VALUES ($1, $2, 'pending') ON CONFLICT DO NOTHING",
            [deploymentId, dev.id]
        );
    }

    // Mark deployment as In Progress once targets are resolved
    await pool.query("UPDATE deployments SET status = 'in_progress' WHERE id = $1", [deploymentId]);
}

// 2. Get Deployment Status (Summary for UI Progress Bar)
exports.getDeploymentStatus = async (req, res) => {
    const { id } = req.params;

    try {
        const stats = await pool.query(
            `SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'completed') as completed,
                COUNT(*) FILTER (WHERE status = 'failed') as failed,
                COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
                COUNT(*) FILTER (WHERE status = 'pending') as pending
             FROM deployment_targets WHERE deployment_id = $1`,
            [id]
        );

        const deployDetails = await pool.query(
            `SELECT d.*, a.name as artifact_name, a.version as artifact_version 
             FROM deployments d 
             JOIN artifacts a ON d.artifact_id = a.id 
             WHERE d.id = $1`,
            [id]
        );

        if (deployDetails.rows.length === 0) return res.status(404).json({ message: "Deployment not found" });

        res.json({
            success: true,
            deployment: deployDetails.rows[0],
            stats: stats.rows[0],
            progress_percent: stats.rows[0].total > 0 ? (stats.rows[0].completed / stats.rows[0].total) * 100 : 0
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// 3. Deployment Executor Job (Wakes up every 10s per Sir Spec)
exports.startDeploymentExecutorJob = () => {
    setInterval(async () => {
        try {
            // Find 10 pending targets and the actual artifact bits
            const targets = await pool.query(
                `SELECT dt.id as target_id, dt.deployment_id, dt.device_id, 
                        a.binary_path, a.version, a.name as artifact_name
                 FROM deployment_targets dt
                 JOIN deployments d ON dt.deployment_id = d.id
                 JOIN artifacts a ON d.artifact_id = a.id
                 WHERE dt.status = 'pending' 
                 AND d.status = 'in_progress'
                 LIMIT 10`
            );

            for (const target of targets.rows) {
                // 1. Create a physical command in the database
                // Device will retrieve this via Polling every 10 seconds.
                await pool.query(
                    `INSERT INTO commands (device_id, type, payload, status, expires_at)
                     VALUES ($1, 'INSTALL_ARTIFACT', $2, 'queued', NOW() + INTERVAL '24 hours')`,
                    [target.device_id, JSON.stringify({
                        binary_path: target.binary_path,
                        version: target.version,
                        artifact_name: target.artifact_name
                    })]
                );

                // 2. Mark the target as 'sent' (in_progress in this spec)
                await pool.query(
                    "UPDATE deployment_targets SET status = 'in_progress' WHERE id = $1",
                    [target.target_id]
                );
            }
        } catch (error) {
            console.error("DEPLOYMENT EXECUTOR ERROR:", error);
        }
    }, 10000);
};

// 4. Report Deployment Event (Device Callback)
exports.reportDeploymentEvent = async (req, res) => {
    const { deployment_id, event_type, event_payload } = req.body;
    const deviceId = req.user.id;

    try {
        // Log the exact history event
        await pool.query(
            `INSERT INTO deployment_events (deployment_id, device_id, event_type, event_payload)
             VALUES ($1, $2, $3, $4)`,
            [deployment_id, deviceId, event_type, event_payload || {}]
        );

        // Map event to internal status
        let newStatus = null;
        if (event_type === 'install_completed') newStatus = 'completed';
        if (event_type === 'install_failed') newStatus = 'failed';

        if (newStatus) {
            await pool.query(
                "UPDATE deployment_targets SET status = $1 WHERE deployment_id = $2 AND device_id = $3",
                [newStatus, deployment_id, deviceId]
            );
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
};
