const pool = require("../../config/db");
const { sendCommand } = require("../../gateway/socket.gateway");
const { logAudit } = require("../../utils/audit");
const fs = require("fs");
const path = require("path");

const gernateMockPresignedUrl = (filepath) => {
    return `http://localhost:5000${filepath}?token=mock_signed_token`;
};

// 1. Upload Artifact (Draft)
exports.uploadArtifact = async (req, res) => {
    const { version, name, type } = req.body; // type: 'app' or 'firmware'
    const tenant_id = req.user.tenant_id;
    const file = req.file;

    if (!file) {
        return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    try {
        const binaryPath = `/uploads/${file.filename}`;

        const result = await pool.query(
            `INSERT INTO artifacts (tenant_id, name, version, type, binary_path, status, created_by)
             VALUES ($1, $2, $3, $4, $5, 'draft', $6)
             RETURNING *`,
            [tenant_id, name, version, type || 'app', binaryPath, req.user.id]
        );

        await logAudit(tenant_id, req.user.id, "artifact.upload", "ARTIFACT", result.rows[0].id, { name, version });

        res.status(201).json({
            success: true,
            message: "Artifact uploaded as Draft",
            artifact: result.rows[0]
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
};

// 2. Approve Artifact (Publish)
exports.approveArtifact = async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            "UPDATE artifacts SET status = 'published', approved_by = $1, approved_at = NOW() WHERE id = $2 RETURNING *",
            [req.user.id, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Artifact not found" });
        }

        const artifact = result.rows[0];
        await logAudit(artifact.tenant_id, req.user.id, "artifact.publish", "ARTIFACT", id, { status: 'published' });

        res.json({ success: true, message: "Artifact Published" });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};

// 3. Deploy Artifact
exports.deployArtifact = async (req, res) => {
    const { id } = req.params;
    const { deviceIds } = req.body;

    if (!deviceIds || !Array.isArray(deviceIds)) {
        return res.status(400).json({ success: false, message: "deviceIds array required" });
    }

    try {
        // Fetch Artifact
        const artRes = await pool.query("SELECT * FROM artifacts WHERE id = $1", [id]);
        if (artRes.rows.length === 0) {
            return res.status(404).json({ message: "Artifact not found" });
        }
        const artifact = artRes.rows[0];

        if (artifact.status !== 'published') {
            return res.status(400).json({ message: "Artifact must be published to deploy" });
        }

        const downloadUrl = gernateMockPresignedUrl(artifact.binary_path);
        const results = [];

        for (const deviceId of deviceIds) {
            const cmdRes = await pool.query(
                `INSERT INTO commands (device_id, type, payload, status, created_by)
                 VALUES ($1, 'install_app', $2, 'queued', $3) RETURNING id`,
                [deviceId, { url: downloadUrl, artifact_id: artifact.id }, req.user.id]
            );
            const cmdId = cmdRes.rows[0].id;

            const sent = sendCommand(deviceId, {
                type: "command",
                id: cmdId,
                cmd: "install_app",
                url: downloadUrl,
                artifact_id: artifact.id
            });

            if (sent) {
                await pool.query("UPDATE commands SET status = 'sent', sent_at = NOW() WHERE id = $1", [cmdId]);
            }

            results.push({ deviceId, cmdId, status: sent ? 'sent' : 'queued' });
        }

        res.json({ success: true, message: "Deployment Commands Sent", results });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
};
