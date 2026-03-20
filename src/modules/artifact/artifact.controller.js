const pool = require("../../config/db");
const crypto = require("crypto");
const { logAudit } = require("../../utils/audit");
const path = require("path");
const fs = require("fs");

/**
 * ARTIFACT FLOW - STAGE 1: UPLOAD & REGISTER
 * 1. Admin uploads APK/Firmware via Multer.
 * 2. Server saves file to uploads/artifacts/.
 * 3. Server creates record in 'artifacts' table (status: draft).
 */

// 1. Upload & Create Artifact
exports.uploadArtifact = async (req, res) => {
    const { name, version, type } = req.body;

    if (!req.file) {
        return res.status(400).json({ success: false, message: "No binary file uploaded." });
    }

    if (!name || !version || !type) {
        // Cleanup file if validation fails
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ success: false, message: "name, version, and type (app/firmware) are required." });
    }

    const tenantId = req.user.role === "SUPER_ADMIN" ? (req.body.tenant_id || req.user.tenant_id) : req.user.tenant_id;

    try {
        // 🔒 SECURITY CHECK: Ensure Tenant is Active
        const tenantRes = await pool.query(
            "SELECT id, status, deleted_at FROM tenants WHERE id = $1",
            [tenantId]
        );

        if (tenantRes.rows.length === 0 || tenantRes.rows[0].deleted_at || tenantRes.rows[0].status === 'deleted') {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(403).json({ success: false, message: "Action Denied: This company/tenant is deleted or inactive. Uploads are disabled." });
        }

        const binaryPath = req.file.path.replace(/\\/g, "/"); // Normalize for DB

        const result = await pool.query(
            `INSERT INTO artifacts (tenant_id, name, version, type, binary_path, status)
             VALUES ($1, $2, $3, $4, $5, 'draft')
             RETURNING *`,
            [tenantId, name, version, type, binaryPath]
        );

        await logAudit(tenantId, req.user.id, "ARTIFACT_UPLOADED", "ARTIFACT", result.rows[0].id, { name, version, type });

        res.status(201).json({
            success: true,
            message: "Artifact uploaded and registered in Draft status.",
            data: result.rows[0]
        });
    } catch (error) {
        console.error("UPLOAD_ARTIFACT_ERROR:", error);
        // Cleanup file on DB error
        if (req.file) fs.unlinkSync(req.file.path);
        res.status(500).json({ success: false, message: "Server error during registration", detail: error.message });
    }
};

// 2. Approve Artifact (Stage 2)
exports.approveArtifact = async (req, res) => {
    const { id } = req.params;

    try {
        // 1. Fetch artifact and check if its Tenant is still active
        const artifactRes = await pool.query(
            `SELECT a.*, t.status as tenant_status, t.deleted_at as tenant_deleted_at
             FROM artifacts a
             JOIN tenants t ON a.tenant_id = t.id
             WHERE a.id = $1 AND a.deleted_at IS NULL`,
            [id]
        );

        if (artifactRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Artifact not found." });
        }

        const artifact = artifactRes.rows[0];

        // 🛡️ SECURITY CHECK: Authority Isolation
        // Allowed: Tenant Admin and Operator (Only from the SAME tenant)
        if (req.user.role !== 'TENANT_ADMIN' && req.user.role !== 'OPERATOR') {
            return res.status(403).json({ success: false, message: "Permission Denied: Only a Tenant Admin or Operator has the authority to approve software updates." });
        }

        // Even an Operator or Admin cannot approve an artifact belonging to another company.
        if (artifact.tenant_id !== req.user.tenant_id) {
            return res.status(403).json({ success: false, message: "Security Violation: Only an Admin or Operator belonging to this company can approve the file." });
        }

        // 🛡️ SECURITY CHECK: Deleted Tenant Protection
        if (artifact.tenant_deleted_at || artifact.tenant_status === 'deleted') {
            return res.status(400).json({ success: false, message: "Action Denied: This artifact belongs to a deleted/deactivated tenant." });
        }

        if (artifact.status === 'approved') {
            return res.status(400).json({ success: false, message: "Artifact is already approved." });
        }

        const result = await pool.query(
            `UPDATE artifacts 
             SET status = 'approved', approved_by = $1, approved_at = NOW() 
             WHERE id = $2 RETURNING *`,
            [req.user.id, id]
        );

        await logAudit(result.rows[0].tenant_id, req.user.id, "ARTIFACT_APPROVED", "ARTIFACT", id, { 
            name: result.rows[0].name, 
            version: result.rows[0].version 
        });

        res.json({
            success: true,
            message: "Artifact approved. It is now ready for deployment to devices.",
            data: result.rows[0]
        });
    } catch (error) {
        console.error("APPROVE_ARTIFACT_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// 3. List Artifacts
exports.getArtifacts = async (req, res) => {
    const { type, status } = req.query;

    try {
        let query = `
            SELECT a.*, t.name as tenant_name, u.email as approved_by_email
            FROM artifacts a
            JOIN tenants t ON a.tenant_id = t.id
            LEFT JOIN users u ON a.approved_by = u.id
            WHERE a.deleted_at IS NULL
        `;
        const params = [];

        if (req.user.role !== "SUPER_ADMIN") {
            params.push(req.user.tenant_id);
            query += ` AND a.tenant_id = $${params.length}`;
        }

        if (type) {
            params.push(type);
            query += ` AND a.type = $${params.length}`;
        }

        if (status) {
            params.push(status);
            query += ` AND a.status = $${params.length}`;
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
        res.status(500).json({ success: false, message: "Server error" });
    }
};

// 4. Delete Artifact
exports.deleteArtifact = async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            "UPDATE artifacts SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING *",
            [id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: "Artifact not found." });
        }

        await logAudit(result.rows[0].tenant_id, req.user.id, "ARTIFACT_DELETED", "ARTIFACT", id);

        res.json({ success: true, message: "Artifact deleted successfully." });
    } catch (error) {
        console.error("DELETE_ARTIFACT_ERROR:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};
