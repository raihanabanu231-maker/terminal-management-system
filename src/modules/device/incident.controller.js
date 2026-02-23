const pool = require("../../config/db");

// 1. Report Incident (From Device)
exports.reportIncident = async (req, res) => {
    const device_id = req.user.id;
    const { type, payload } = req.body;

    try {
        // Find existing open incident of same type for this device
        const existing = await pool.query(
            "SELECT id FROM device_incidents WHERE device_id = $1 AND type = $2 AND status = 'open'",
            [device_id, type]
        );

        let incidentId;

        if (existing.rows.length > 0) {
            incidentId = existing.rows[0].id;
        } else {
            // Fetch device details for context
            const deviceRes = await pool.query("SELECT tenant_id, merchant_id FROM devices WHERE id = $1", [device_id]);
            const device = deviceRes.rows[0];

            // Create new incident
            const result = await pool.query(
                `INSERT INTO device_incidents (device_id, tenant_id, merchant_id, type, first_seen)
                 VALUES ($1, $2, $3, $4, NOW()) RETURNING id`,
                [device_id, device.tenant_id, device.merchant_id, type]
            );
            incidentId = result.rows[0].id;
        }

        // Add incident event
        await pool.query(
            "INSERT INTO incident_events (incident_id, event_type, payload) VALUES ($1, $2, $3)",
            [incidentId, type, payload || {}]
        );

        res.json({ success: true, incident_id: incidentId });
    } catch (error) {
        console.error("Report Incident Error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// 2. Report Telemetry (Vitals)
exports.reportTelemetry = async (req, res) => {
    const device_id = req.user.id;
    const { cpu, ram, battery, storage, custom } = req.body;

    try {
        await pool.query(
            `INSERT INTO device_telemetry (device_id, cpu_usage, ram_usage, battery_level, storage_usage, custom_data)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [device_id, cpu, ram, battery, storage, custom || {}]
        );

        res.json({ success: true });
    } catch (error) {
        console.error("Report Telemetry Error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

// 3. Get Incidents (For Dashboard)
exports.getIncidents = async (req, res) => {
    const { tenant_id } = req.user;

    try {
        const result = await pool.query(
            `SELECT i.*, d.serial, d.model 
             FROM device_incidents i
             JOIN devices d ON i.device_id = d.id
             WHERE i.tenant_id = $1
             ORDER BY i.created_at DESC LIMIT 50`,
            [tenant_id]
        );

        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error("Get Incidents Error:", error);
        res.status(500).json({ message: "Server error" });
    }
};
