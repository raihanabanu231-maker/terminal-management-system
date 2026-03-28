const pool = require("../../config/db");

exports.getQuickMetrics = async (req, res) => {
    const userRole = req.user.role;
    const { tenant_id: queryTenantId } = req.query;
    const finalTenantId = (userRole === "SUPER_ADMIN" && queryTenantId)
        ? queryTenantId
        : req.user.tenant_id;

    try {
        let deviceConstraint = "";
        let incidentConstraint = "";
        let commandConstraint = "";
        let deploymentConstraint = "";
        const params = [];

        if (userRole !== "SUPER_ADMIN" || finalTenantId) {
            params.push(finalTenantId);
            deviceConstraint = " AND d.tenant_id = $1";
            incidentConstraint = " WHERE tenant_id = $1";
            commandConstraint = " WHERE d.tenant_id = $1";
            deploymentConstraint = " WHERE dep.tenant_id = $1";
        }

        // Run multiple queries in parallel for efficiency
        const [devices, openIncidents, pendingCommands, deploymentStats] = await Promise.all([
            // Device counts (Total vs Online)
            pool.query(
                `SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE d.status = 'active' AND d.last_seen > NOW() - INTERVAL '5 minutes') as online
                 FROM devices d WHERE d.deleted_at IS NULL ${deviceConstraint}`,
                params
            ),
            // Open incidents
            pool.query(
                `SELECT COUNT(*) FROM device_incidents ${incidentConstraint} ${incidentConstraint ? 'AND' : 'WHERE'} status = 'open' AND deleted_at IS NULL`,
                params
            ),
            // Pending commands
            pool.query(
                `SELECT COUNT(*) FROM commands c
                 JOIN devices d ON c.device_id = d.id
                 ${commandConstraint} ${commandConstraint ? 'AND' : 'WHERE'} c.status = 'queued'`,
                params
            ),
            // Software Update Failures (Last 24 Hours)
            pool.query(
                `SELECT 
                    COUNT(*) FILTER (WHERE dt.status = 'failed') as failed_24h,
                    COUNT(*) FILTER (WHERE dt.status = 'completed') as success_24h
                 FROM deployment_targets dt
                 JOIN deployments dep ON dt.deployment_id = dep.id
                 ${deploymentConstraint} ${deploymentConstraint ? 'AND' : 'WHERE'} dt.updated_at > NOW() - INTERVAL '24 hours'`,
                params
            )
        ]);

        const data = {
            total_devices: parseInt(devices.rows[0].total || 0),
            online_devices: parseInt(devices.rows[0].online || 0),
            open_incidents: parseInt(openIncidents.rows[0].count || 0),
            pending_commands: parseInt(pendingCommands.rows[0].count || 0),
            deployments_today: {
                failed: parseInt(deploymentStats.rows[0].failed_24h || 0),
                successful: parseInt(deploymentStats.rows[0].success_24h || 0)
            }
        };

        res.json({ success: true, data });
    } catch (error) {
        console.error("Dashboard Metrics Error:", error);
        res.status(500).json({ message: "Server error" });
    }
};
