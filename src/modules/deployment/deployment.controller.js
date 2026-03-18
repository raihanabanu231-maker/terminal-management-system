const pool = require("../../config/db");
const { logAudit } = require("../../utils/audit");

// 1. Create Deployment (Step 1 in Sir's spec)
exports.createDeployment = async (req, res) => {
    const { artifact_id, target_type, target_id, rollout_percentage, deployment_strategy } = req.body;

    if (!artifact_id || !target_type || !target_id) {
        return res.status(400).json({ success: false, message: "artifact_id, target_type, and target_id are required" });
    }

    const tenantId = req.user.role === "SUPER_ADMIN" ? (req.body.tenant_id || req.user.tenant_id) : req.user.tenant_id;

    try {
        // Verify artifact exists and is approved
        const artifactRes = await pool.query(
            "SELECT * FROM artifacts WHERE id = $1 AND status = 'approved' AND deleted_at IS NULL",
            [artifact_id]
        );

        if (artifactRes.rows.length === 0) {
            return res.status(400).json({ success: false, message: "Artifact not found or not approved. Only approved artifacts can be deployed." });
        }

        const artifact = artifactRes.rows[0];

        // Create deployment
        const result = await pool.query(
            `INSERT INTO deployments (tenant_id, artifact_id, deployment_strategy, target_type, target_id, rollout_percentage, status, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
             RETURNING *`,
            [tenantId, artifact_id, deployment_strategy || 'immediate', target_type, target_id, rollout_percentage || 100, req.user.id]
        );

        const deployment = result.rows[0];

        // Step 2: Resolve Targets (Expand targets to deployment_targets table)
        await resolveDeploymentTargets(deployment);

        await logAudit(tenantId, req.user.id, "DEPLOYMENT_CREATED", "DEPLOYMENT", deployment.id, {
            artifact: artifact.name,
            version: artifact.version,
            target_type,
            target_id
        });

        const targetCount = await pool.query(
            "SELECT COUNT(*) FROM deployment_targets WHERE deployment_id = $1",
            [deployment.id]
        );

        res.status(201).json({
            success: true,
            message: "Deployment created and targets resolved",
            deployment: {
                ...deployment,
                target_count: parseInt(targetCount.rows[0].count)
            }
        });
    } catch (error) {
        console.error("CREATE_DEPLOYMENT_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error", detail: error.message });
    }
};

// Target Resolver (Step 2 logic)
async function resolveDeploymentTargets(deployment) {
    const { id: deploymentId, target_type, target_id, rollout_percentage, tenant_id } = deployment;

    let devices = [];

    if (target_type === 'device') {
        const res = await pool.query(
            "SELECT id FROM devices WHERE id = $1 AND status = 'active' AND deleted_at IS NULL",
            [target_id]
        );
        devices = res.rows;
    } else if (target_type === 'merchant') {
        const res = await pool.query(
            `SELECT d.id FROM devices d
             JOIN merchants m ON d.merchant_id = m.id
             WHERE (m.id = $1 OR m.path LIKE '%' || $1::text || '%')
             AND d.status = 'active' AND d.deleted_at IS NULL`,
            [target_id]
        );
        devices = res.rows;
    } else if (target_type === 'tenant') {
        const res = await pool.query(
            "SELECT id FROM devices WHERE tenant_id = $1 AND status = 'active' AND deleted_at IS NULL",
            [target_id]
        );
        devices = res.rows;
    } else if (target_type === 'device_group' || target_type === 'group') {
        const res = await pool.query(
            "SELECT id FROM devices WHERE tenant_id = $1 AND status = 'active' AND deleted_at IS NULL",
            [tenant_id]
        );
        devices = res.rows;
    }

    if (rollout_percentage < 100 && devices.length > 0) {
        const targetCount = Math.ceil(devices.length * (rollout_percentage / 100));
        devices = devices.sort(() => Math.random() - 0.5).slice(0, targetCount);
    }

    for (const device of devices) {
        await pool.query(
            `INSERT INTO deployment_targets (deployment_id, device_id, status)
             VALUES ($1, $2, 'pending')
             ON CONFLICT DO NOTHING`,
            [deploymentId, device.id]
        );
    }

    await pool.query(
        "UPDATE deployments SET status = 'in_progress' WHERE id = $1",
        [deploymentId]
    );
}

// 2. List Deployments
exports.getDeployments = async (req, res) => {
    const { status } = req.query;

    try {
        let query = `SELECT d.*, a.name as artifact_name, a.version as artifact_version, a.artifact_type,
                      u.email as created_by_email, t.name as tenant_name,
                      CASE 
                        WHEN d.target_type = 'merchant' THEN (SELECT name FROM merchants WHERE id = d.target_id)
                        WHEN d.target_type = 'device' THEN (SELECT serial FROM devices WHERE id = d.target_id)
                        WHEN d.target_type = 'tenant' THEN (SELECT name FROM tenants WHERE id = d.target_id)
                        WHEN d.target_type IN ('group', 'device_group') THEN 'Device Group'
                        ELSE 'Unknown'
                      END as target_name,
                      (SELECT COUNT(*) FROM deployment_targets dt WHERE dt.deployment_id = d.id) as total_targets,
                      (SELECT COUNT(*) FROM deployment_targets dt WHERE dt.deployment_id = d.id AND dt.status = 'completed') as completed_targets,
                      (SELECT COUNT(*) FROM deployment_targets dt WHERE dt.deployment_id = d.id AND dt.status = 'failed') as failed_targets
                     FROM deployments d
                     JOIN artifacts a ON d.artifact_id = a.id
                     JOIN tenants t ON d.tenant_id = t.id
                     LEFT JOIN users u ON d.created_by = u.id
                     WHERE 1=1`;
        const params = [];

        if (req.user.role !== "SUPER_ADMIN") {
            params.push(req.user.tenant_id);
            query += ` AND d.tenant_id = $${params.length}`;
        }

        if (status) {
            params.push(status);
            query += ` AND d.status = $${params.length}`;
        }

        query += " ORDER BY d.created_at DESC";

        const result = await pool.query(query, params);

        res.json({
            success: true,
            total: result.rowCount,
            data: result.rows
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error", detail: error.message });
    }
};

// 3. Get Deployment Details
exports.getDeploymentById = async (req, res) => {
    const { id } = req.params;

    try {
        const deployRes = await pool.query(
            `SELECT d.*, a.name as artifact_name, a.version as artifact_version, a.artifact_type, a.file_url, a.file_hash, t.name as tenant_name,
                    CASE 
                        WHEN d.target_type = 'merchant' THEN (SELECT name FROM merchants WHERE id = d.target_id)
                        WHEN d.target_type = 'device' THEN (SELECT serial FROM devices WHERE id = d.target_id)
                        WHEN d.target_type = 'tenant' THEN (SELECT name FROM tenants WHERE id = d.target_id)
                        WHEN d.target_type IN ('group', 'device_group') THEN 'Device Group'
                        ELSE 'Unknown'
                    END as target_name
             FROM deployments d
             JOIN artifacts a ON d.artifact_id = a.id
             JOIN tenants t ON d.tenant_id = t.id
             WHERE d.id = $1`,
            [id]
        );

        if (deployRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Deployment not found" });
        }

        const targetsRes = await pool.query(
            `SELECT dt.*, dev.serial, dev.model, dev.status as device_status
             FROM deployment_targets dt
             JOIN devices dev ON dt.device_id = dev.id
             WHERE dt.deployment_id = $1
             ORDER BY dt.created_at`,
            [id]
        );

        const eventsRes = await pool.query(
            `SELECT de.*, dev.serial
             FROM deployment_events de
             JOIN devices dev ON de.device_id = dev.id
             WHERE de.deployment_id = $1
             ORDER BY de.created_at DESC LIMIT 50`,
            [id]
        );

        const summary = {
            total: targetsRes.rowCount,
            pending: targetsRes.rows.filter(t => t.status === 'pending').length,
            in_progress: targetsRes.rows.filter(t => t.status === 'in_progress').length,
            completed: targetsRes.rows.filter(t => t.status === 'completed').length,
            failed: targetsRes.rows.filter(t => t.status === 'failed').length
        };

        res.json({
            success: true,
            data: {
                ...deployRes.rows[0],
                summary,
                targets: targetsRes.rows,
                events: eventsRes.rows
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error", detail: error.message });
    }
};

// 4. Device Reports Deployment Event (Step 3 callback)
exports.reportDeploymentEvent = async (req, res) => {
    const { deployment_id, event_type, event_payload } = req.body;
    const deviceId = req.user.id;

    if (!deployment_id || !event_type) {
        return res.status(400).json({ success: false, message: "deployment_id and event_type are required" });
    }

    try {
        await pool.query(
            `INSERT INTO deployment_events (deployment_id, device_id, event_type, event_payload)
             VALUES ($1, $2, $3, $4)`,
            [deployment_id, deviceId, event_type, event_payload || {}]
        );

        let newStatus = null;
        switch (event_type) {
            case 'download_started':
            case 'install_started':
                newStatus = 'in_progress';
                break;
            case 'install_completed':
                newStatus = 'completed';
                break;
            case 'install_failed':
                newStatus = 'failed';
                break;
        }

        if (newStatus) {
            await pool.query(
                "UPDATE deployment_targets SET status = $1 WHERE deployment_id = $2 AND device_id = $3",
                [newStatus, deployment_id, deviceId]
            );
        }

        const pendingCount = await pool.query(
            "SELECT COUNT(*) FROM deployment_targets WHERE deployment_id = $1 AND status IN ('pending', 'in_progress')",
            [deployment_id]
        );

        if (parseInt(pendingCount.rows[0].count) === 0) {
            await pool.query(
                "UPDATE deployments SET status = 'completed' WHERE id = $1",
                [deployment_id]
            );
        }

        res.json({ success: true, message: "Deployment event recorded" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error", detail: error.message });
    }
};

// 5. Deployment Executor Job (Step 3 logic - 10s interval)
exports.startDeploymentExecutorJob = () => {
    setInterval(async () => {
        try {
            const targets = await pool.query(
                `SELECT dt.id as target_id, dt.deployment_id, dt.device_id, 
                        a.file_url, a.file_hash, a.version, a.name as artifact_name
                 FROM deployment_targets dt
                 JOIN deployments d ON dt.deployment_id = d.id
                 JOIN artifacts a ON d.artifact_id = a.id
                 WHERE dt.status = 'pending' 
                 AND d.status = 'in_progress'
                 LIMIT 10`
            );

            for (const target of targets.rows) {
                await pool.query(
                    `INSERT INTO commands (device_id, type, payload, status, created_by, expires_at)
                     VALUES ($1, 'INSTALL_ARTIFACT', $2, 'queued', NULL, NOW() + INTERVAL '24 hours')`,
                    [target.device_id, JSON.stringify({
                        artifact_url: target.file_url,
                        artifact_hash: target.file_hash,
                        version: target.version,
                        artifact_name: target.artifact_name
                    })]
                );

                await pool.query(
                    "UPDATE deployment_targets SET status = 'in_progress' WHERE id = $1",
                    [target.target_id]
                );
            }
            if (targets.rowCount > 0) console.log(`📦 Deployment Executor: Generated ${targets.rowCount} commands.`);
        } catch (error) {
            console.error("Deployment Executor Error:", error);
        }
    }, 10000);
};
