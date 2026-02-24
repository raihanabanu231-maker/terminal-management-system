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

        // Hierarchy Filtering Logic
        if (userRole === "SUPER_ADMIN") {
            if (tenant_id) {
                params.push(tenant_id);
                query += ` WHERE m.tenant_id = $${params.length}`;
            }
        } else {
            // All non-super-admins are locked to their tenant
            params.push(req.user.tenant_id);
            query += ` WHERE m.tenant_id = $${params.length}`;

            // 🎯 NEW: Merchant Scoping
            // Check if user has a merchant scope in their JWT
            const merchantRole = req.user.roles?.find(r => r.scope === 'merchant');
            if (merchantRole) {
                params.push(merchantRole.scope_id);
                query += ` AND m.path LIKE (SELECT path FROM merchants WHERE id = $${params.length}) || '%'`;
            }
        }

        query += " ORDER BY m.path ASC";

        const result = await pool.query(query, params);
        res.json({ success: true, count: result.rows.length, data: result.rows });
    } catch (error) {
        console.error("GetMerchants ERROR:", error);
        res.status(500).json({ message: "Server error", detail: error.message });
    }
};
