const pool = require("../../config/db");

exports.getQuickMetrics = async (req, res) => {
    const { tenant_id } = req.user;

    try {
        // Run multiple queries in parallel for efficiency
        const [devices, openIncidents, pendingCommands] = await Promise.all([
            // Device counts (Total vs Online)
            pool.query(
                `SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE status = 'active' AND last_seen > NOW() - INTERVAL '5 minutes') as online
                 FROM devices WHERE tenant_id = $1 AND deleted_at IS NULL`,
                [tenant_id]
            ),
            // Open incidents
            pool.query(
                "SELECT COUNT(*) FROM device_incidents WHERE tenant_id = $1 AND status = 'open'",
                [tenant_id]
            ),
            // Pending commands
            pool.query(
                `SELECT COUNT(*) FROM commands c
                 JOIN devices d ON c.device_id = d.id
                 WHERE d.tenant_id = $1 AND c.status = 'queued'`,
                [tenant_id]
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
