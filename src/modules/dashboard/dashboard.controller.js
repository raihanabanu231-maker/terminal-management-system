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
        const params = [];

        if (userRole !== "SUPER_ADMIN" || finalTenantId) {
            params.push(finalTenantId);
            deviceConstraint = " AND d.tenant_id = $1";
            incidentConstraint = " WHERE tenant_id = $1";
            commandConstraint = " WHERE d.tenant_id = $1";
        }

        // Run multiple queries in parallel for efficiency
        const [devices, openIncidents, pendingCommands] = await Promise.all([
            // Device counts (Total vs Online)
            pool.query(
                `SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE status = 'active' AND last_seen > NOW() - INTERVAL '5 minutes') as online
                 FROM devices d WHERE d.deleted_at IS NULL ${deviceConstraint}`,
                params
            ),
            // Open incidents
            pool.query(
                `SELECT COUNT(*) FROM device_incidents ${incidentConstraint} ${incidentConstraint ? 'AND' : 'WHERE'} status = 'open'`,
                params
            ),
            // Pending commands
            pool.query(
                `SELECT COUNT(*) FROM commands c
                 JOIN devices d ON c.device_id = d.id
                 ${commandConstraint} ${commandConstraint ? 'AND' : 'WHERE'} c.status = 'queued'`,
                params
            )
        ]);

        const data = {
            total_devices: parseInt(devices.rows[0].total),
            online_devices: parseInt(devices.rows[0].online),
            open_incidents: parseInt(openIncidents.rows[0].count),
            pending_commands: parseInt(pendingCommands.rows[0].count)
        };

        res.json({ success: true, data });
    } catch (error) {
        console.error("Dashboard Metrics Error:", error);
        res.status(500).json({ message: "Server error" });
    }
};
