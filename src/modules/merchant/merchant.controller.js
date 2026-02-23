const pool = require("../../config/db");

// Create a new Merchant (Store/Region)
exports.createMerchant = async (req, res) => {
    const { name, parent_id, external_id, tenant_id } = req.body;

    // Logic: Super Admin can specify tenant, others are locked to their own
    const finalTenantId = (req.user.role === "SUPER_ADMIN" && tenant_id)
        ? tenant_id
        : req.user.tenant_id;

    try {
        const result = await pool.query(
            `INSERT INTO merchants (name, tenant_id, parent_id, external_id, path) 
             VALUES ($1, $2, $3, $4, '') 
             RETURNING *`,
            [name, finalTenantId, parent_id || null, external_id || null]
        );

        res.status(201).json({
            success: true,
            message: "Merchant created successfully",
            data: result.rows[0]
        });
    } catch (error) {
        console.error("CreateMerchant ERROR:", error);
        res.status(500).json({ message: "Server error", detail: error.message });
    }
};

// Get Merchant Hierarchy
exports.getMerchants = async (req, res) => {
    const userRole = req.user.role;
    const { tenant_id } = req.query;

    try {
        let query = "SELECT m.*, t.name as tenant_name FROM merchants m JOIN tenants t ON m.tenant_id = t.id";
        const params = [];

        // If NOT Super Admin, restrict to their own tenant
        if (userRole !== "SUPER_ADMIN") {
            params.push(req.user.tenant_id);
            query += ` WHERE m.tenant_id = $${params.length}`;
        } else if (tenant_id) {
            // Super Admin can filter by a specific tenant
            params.push(tenant_id);
            query += ` WHERE m.tenant_id = $${params.length}`;
        }

        query += " ORDER BY m.path ASC";

        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error("GetMerchants ERROR:", error);
        res.status(500).json({ message: "Server error", detail: error.message });
    }
};
