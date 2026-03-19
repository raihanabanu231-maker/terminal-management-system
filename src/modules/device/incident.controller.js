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
    const { reported_at, ...payload } = req.body; // Expecting reported_at and generic vitals

    try {
        await pool.query(
            `INSERT INTO device_telemetry (device_id, reported_at, payload)
             VALUES ($1, $2, $3)`,
            [device_id, reported_at || new Date(), payload || {}]
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
    const userRole = req.user.role;

    try {
        let query = `
             SELECT i.*, d.serial, d.model, t.name as tenant_name, m.name as merchant_name 
             FROM device_incidents i
             JOIN devices d ON i.device_id = d.id
             JOIN tenants t ON i.tenant_id = t.id
             LEFT JOIN merchants m ON i.merchant_id = m.id
        `;
        const params = [];

        if (userRole === "SUPER_ADMIN") {
            // Super Admin optionally filters by tenant_id from query if provided
            if (req.query.tenant_id) {
                params.push(req.query.tenant_id);
                query += " WHERE i.tenant_id = $1";
            }
        } else {
            // Regular users are locked to their tenant
            params.push(tenant_id);
            query += " WHERE i.tenant_id = $1";
        }

        query += " ORDER BY i.created_at DESC LIMIT 50";

        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error("Get Incidents Error:", error);
        res.status(500).json({ message: "Server error" });
    }
};
