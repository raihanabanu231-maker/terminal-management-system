const pool = require("../../config/db");
const crypto = require("crypto");
const { logAudit } = require("../../utils/audit");

// 1. Create Artifact (Step 2 in Sir's spec)
exports.createArtifact = async (req, res) => {
    const { name, version, artifact_type, file_url, file_hash, file_size, min_device_version } = req.body;

    if (!name || !version || !artifact_type) {
        return res.status(400).json({ success: false, message: "name, version, and artifact_type are required" });
    }

    const tenantId = req.user.role === "SUPER_ADMIN" ? (req.body.tenant_id || req.user.tenant_id) : req.user.tenant_id;

    try {
        const result = await pool.query(
            `INSERT INTO artifacts (tenant_id, name, version, artifact_type, file_url, file_hash, file_size, min_device_version, created_by, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft')
             RETURNING *`,
            [tenantId, name, version, artifact_type, file_url || null, file_hash || null, file_size || null, min_device_version || null, req.user.id]
        );

        await logAudit(tenantId, req.user.id, "ARTIFACT_CREATED", "ARTIFACT", result.rows[0].id, { name, version, artifact_type });

        res.status(201).json({
            success: true,
            message: "Artifact created in draft status",
            artifact: result.rows[0]
        });
    } catch (error) {
        console.error("CREATE_ARTIFACT_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error", detail: error.message });
    }
};

// 2. Upload Artifact File (Step 1 in Sir's spec)
// For MVP: stores file_url directly. In production: integrate with S3/GCS.
exports.uploadArtifact = async (req, res) => {
    const { file_url, file_name } = req.body;

    if (!file_url) {
        return res.status(400).json({ success: false, message: "file_url is required" });
    }

    try {
        // Calculate hash from URL (in production, hash the actual file bytes)
        const fileHash = crypto.createHash('sha256').update(file_url + Date.now()).digest('hex');

        res.json({
            success: true,
            message: "File registered successfully",
            file_url: file_url,
            file_hash: fileHash,
            file_name: file_name || "artifact"
        });
    } catch (error) {
        console.error("UPLOAD_ARTIFACT_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error", detail: error.message });
    }
};

// 3. Approve Artifact (Step 3 in Sir's spec)
exports.approveArtifact = async (req, res) => {
    const { id } = req.params;
    const { notes } = req.body;

    try {
        // Verify artifact exists and is in draft status
        const artifactRes = await pool.query(
            "SELECT * FROM artifacts WHERE id = $1 AND deleted_at IS NULL",
            [id]
        );

        if (artifactRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Artifact not found" });
        }

        const artifact = artifactRes.rows[0];

        if (artifact.status === 'approved') {
            return res.status(400).json({ success: false, message: "Artifact is already approved" });
        }

        // Create approval record
        await pool.query(
            `INSERT INTO artifact_approvals (artifact_id, approved_by, notes)
             VALUES ($1, $2, $3)`,
            [id, req.user.id, notes || null]
        );

        // Update artifact status
        await pool.query(
            "UPDATE artifacts SET status = 'approved', updated_at = NOW() WHERE id = $1",
            [id]
        );

        await logAudit(artifact.tenant_id, req.user.id, "ARTIFACT_APPROVED", "ARTIFACT", id, { name: artifact.name, version: artifact.version });

        res.json({
            success: true,
            message: "Artifact approved and ready for deployment"
        });
    } catch (error) {
        console.error("APPROVE_ARTIFACT_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error", detail: error.message });
    }
};

// 4. List Artifacts
exports.getArtifacts = async (req, res) => {
    const { status, artifact_type } = req.query;

    try {
        let query = "SELECT a.*, u.email as created_by_email FROM artifacts a LEFT JOIN users u ON a.created_by = u.id WHERE a.deleted_at IS NULL";
        const params = [];

        if (req.user.role !== "SUPER_ADMIN") {
            params.push(req.user.tenant_id);
            query += ` AND a.tenant_id = $${params.length}`;
        }

        if (status) {
            params.push(status);
            query += ` AND a.status = $${params.length}`;
        }

        if (artifact_type) {
            params.push(artifact_type);
            query += ` AND a.artifact_type = $${params.length}`;
        }

        query += " ORDER BY a.created_at DESC";

        const result = await pool.query(query, params);

        res.json({
            success: true,
            total: result.rowCount,
            data: result.rows
        });
    } catch (error) {
        console.error("GET_ARTIFACTS_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error", detail: error.message });
    }
};

// 5. Get Single Artifact
exports.getArtifactById = async (req, res) => {
    const { id } = req.params;

    try {
        const artifactRes = await pool.query(
            `SELECT a.*, u.email as created_by_email 
             FROM artifacts a 
             LEFT JOIN users u ON a.created_by = u.id 
             WHERE a.id = $1 AND a.deleted_at IS NULL`,
            [id]
        );

        if (artifactRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Artifact not found" });
        }

        // Get approval history
        const approvalsRes = await pool.query(
            `SELECT aa.*, u.email as approved_by_email 
             FROM artifact_approvals aa 
             LEFT JOIN users u ON aa.approved_by = u.id 
             WHERE aa.artifact_id = $1 ORDER BY aa.approved_at DESC`,
            [id]
        );

        res.json({
            success: true,
            data: {
                ...artifactRes.rows[0],
                approvals: approvalsRes.rows
            }
        });
    } catch (error) {
        console.error("GET_ARTIFACT_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error", detail: error.message });
    }
};

// 6. Deprecate Artifact
exports.deprecateArtifact = async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            "UPDATE artifacts SET status = 'deprecated', updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING *",
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: "Artifact not found" });
        }

        await logAudit(result.rows[0].tenant_id, req.user.id, "ARTIFACT_DEPRECATED", "ARTIFACT", id, { name: result.rows[0].name });

        res.json({ success: true, message: "Artifact deprecated successfully" });
    } catch (error) {
        console.error("DEPRECATE_ARTIFACT_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error", detail: error.message });
    }
};
