const pool = require("../../config/db");
const { sendCommand } = require("../../gateway/socket.gateway");
const fs = require("fs");
const path = require("path");

// Simplified Storage Helper (Mock MinIO)
// In a real app, use AWS SDK for S3/MinIO
const storeFile = (file) => {
    // For now, assume it's stored locally by multer, and we generate a local URL
    return `/uploads/${file.filename}`;
};

const gernateMockPresignedUrl = (filepath) => {
    // In production, sign with S3 private key
    // For dev, return localhost URL
    return `http://localhost:5000${filepath}?token=mock_signed_token`;
};

// 1. Upload Artifact (Draft)
exports.uploadArtifact = async (req, res) => {
    const { version, name } = req.body;
    const tenant_id = req.user.tenant_id;
    const file = req.file;

    if (!file) {
        return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    try {
        const binaryPath = storeFile(file);

        const result = await pool.query(
            `INSERT INTO artifacts (tenant_id, name, version, binary_path, status, created_by)
             VALUES ($1, $2, $3, $4, 'DRAFT', $5)
             RETURNING *`,
            [tenant_id, name, version, binaryPath, req.user.id]
        );

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

const { logAudit } = require("../../utils/audit");

// 2. Approve Artifact (Publish)
exports.approveArtifact = async (req, res) => {
    const { id } = req.params;

    try {
        await pool.query(
            "UPDATE artifacts SET status = 'PUBLISHED', approved_by = $1, published_at = NOW() WHERE id = $2",
            [req.user.id, id]
        );

        // Audit Log
        await logAudit("artifact.publish", req.user.id, id, "ARTIFACT", { status: 'PUBLISHED' }, req.ip);

        res.json({ success: true, message: "Artifact Published" });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
};

// 3. Deploy Artifact (Flow 6)
exports.deployArtifact = async (req, res) => {
    const { id } = req.params;
    const { deviceIds } = req.body; // Array of device IDs

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

        if (artifact.status !== 'PUBLISHED') {
            return res.status(400).json({ message: "Artifact must be PUBLISHED to deploy" });
        }

        const downloadUrl = gernateMockPresignedUrl(artifact.binary_path);

        const results = [];

        // Iterate devices and send commands
        for (const deviceId of deviceIds) {
            // Insert command log
            const cmdRes = await pool.query(
                `INSERT INTO commands (device_id, command_type, payload, status)
                 VALUES ($1, 'install_app', $2, 'QUEUED') RETURNING id`,
                [deviceId, JSON.stringify({ url: downloadUrl, artifact_id: artifact.id })]
            );
            const cmdId = cmdRes.rows[0].id;

            // Push via WS
            const sent = sendCommand(deviceId, {
                type: "command",
                id: cmdId,
                cmd: "install_app",
                url: downloadUrl,
                artifact_id: artifact.id
            });

            if (sent) {
                await pool.query("UPDATE commands SET status = 'SENT', sent_at = NOW() WHERE id = $1", [cmdId]);
            }

            results.push({ deviceId, cmdId, status: sent ? 'SENT' : 'QUEUED' });
        }

        res.json({
            success: true,
            message: "Deployment Commands Sent",
            results
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server error" });
    }
};
