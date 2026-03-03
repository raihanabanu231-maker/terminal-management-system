const pool = require("../../config/db");
const crypto = require("crypto");

// Create a new Merchant (Store/Region)
exports.createMerchant = async (req, res) => {
    const { name, parent_id, external_id, tenant_id } = req.body;

    // Logic: Super Admin can specify tenant, others are locked to their own
    const finalTenantId = (req.user.role === "SUPER_ADMIN" && tenant_id)
        ? tenant_id
        : req.user.tenant_id;

    if (!finalTenantId && req.user.role !== "SUPER_ADMIN") {
        return res.status(400).json({ success: false, message: "tenant_id missing from context" });
    }
    if (req.user.role === "SUPER_ADMIN" && !finalTenantId) {
        return res.status(400).json({ success: false, message: "tenant_id is REQUIRED for superadmin." });
    }

    try {
        // --- ADDED: UNIQUE NAME CHECK ---
        // Ensure no other merchant exists with the exact same name under the SAME parent in this tenant
        const duplicateCheckQuery = parent_id
            ? "SELECT id FROM merchants WHERE name = $1 AND tenant_id = $2 AND parent_id = $3"
            : "SELECT id FROM merchants WHERE name = $1 AND tenant_id = $2 AND parent_id IS NULL";

        const queryParams = parent_id
            ? [name, finalTenantId, parent_id]
            : [name, finalTenantId];

        const duplicateRes = await pool.query(duplicateCheckQuery, queryParams);

        if (duplicateRes.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: parent_id
                    ? `A branch named '${name}' already exists inside this Region.`
                    : `A top-level Region named '${name}' already exists for this Tenant.`
            });
        }
        // --- END UNIQUE CHECK ---

        const newId = crypto.randomUUID();
        let path = `${newId}.`;

        if (parent_id) {
            const parentRes = await pool.query("SELECT tenant_id, path FROM merchants WHERE id = $1", [parent_id]);
            if (parentRes.rows.length === 0) {
                return res.status(404).json({ success: false, message: "Parent merchant not found" });
            }
            if (parentRes.rows[0].tenant_id !== finalTenantId) {
                return res.status(400).json({ success: false, message: "Parent merchant belongs to a different tenant" });
            }
            path = `${parentRes.rows[0].path}${newId}.`;
        }

        // Check Merchant Admin scoping
        const merchantRole = req.user.roles?.find(r => r.scope === 'merchant');
        if (req.user.role === 'MERCHANT_ADMIN' || merchantRole) {
            if (!parent_id) {
                return res.status(403).json({ success: false, message: "Merchant admins cannot create top-level merchants. Must provide a valid parent_id." });
            }
            if (!path.includes(merchantRole.scope_id)) {
                return res.status(403).json({ success: false, message: "You can only create stores under your own authorized merchant scope." });
            }
        }

        const result = await pool.query(
            `INSERT INTO merchants (id, name, tenant_id, parent_id, external_id, path) 
             VALUES ($1, $2, $3, $4, $5, $6) 
             RETURNING *`,
            [newId, name, finalTenantId, parent_id || null, external_id || null, path]
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

            // Check if user has a merchant scope in their JWT
            const merchantRole = req.user.roles?.find(r => r.scope === 'merchant');
            if (merchantRole) {
                params.push(merchantRole.scope_id);
                // Safe query construction using a subquery to fetch the precise path of their scope_id
                query += ` AND m.path LIKE (SELECT path FROM merchants WHERE id = $${params.length}) || '%'`;
            }
        }

        query += " ORDER BY m.path ASC";

        const result = await pool.query(query, params);

        // Convert flat array to nested hierarchy tree
        const buildHierarchy = (merchants) => {
            const map = {};
            const roots = [];

            // First pass: map all merchants by their ID and initialize empty children array
            merchants.forEach(merchant => {
                map[merchant.id] = { ...merchant, children: [] };
            });

            // Second pass: assign each merchant to its parent's children array
            merchants.forEach(merchant => {
                if (merchant.parent_id && map[merchant.parent_id]) {
                    map[merchant.parent_id].children.push(map[merchant.id]);
                } else {
                    // No parent_id or parent not found in current scope, treat as a root
                    roots.push(map[merchant.id]);
                }
            });

            return roots;
        };

        const hierarchyData = buildHierarchy(result.rows);

        res.json({ success: true, count: result.rows.length, data: hierarchyData });
    } catch (error) {
        console.error("GetMerchants ERROR:", error);
        res.status(500).json({ message: "Server error", detail: error.message });
    }
};
