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
        let path = `${newId}`;

        if (parent_id) {
            const parentRes = await pool.query("SELECT tenant_id, path FROM merchants WHERE id = $1", [parent_id]);
            if (parentRes.rows.length === 0) {
                return res.status(404).json({ success: false, message: "Parent merchant not found" });
            }
            if (parentRes.rows[0].tenant_id !== finalTenantId) {
                return res.status(400).json({ success: false, message: "Parent merchant belongs to a different tenant" });
            }
            path = `${parentRes.rows[0].path}/${newId}`;
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

// Update an existing Merchant (e.g. moving it to a new region or renaming)
exports.updateMerchant = async (req, res) => {
    const { id } = req.params;
    const { name, parent_id, external_id } = req.body;
    const finalTenantId = req.user.role === "SUPER_ADMIN" ? req.body.tenant_id || req.user.tenant_id : req.user.tenant_id;

    try {
        const currentRes = await pool.query("SELECT * FROM merchants WHERE id = $1", [id]);
        if (currentRes.rows.length === 0) return res.status(404).json({ success: false, message: "Merchant not found" });

        const currentMerchant = currentRes.rows[0];

        // Ensure cross-tenant modification doesn't happen
        if (currentMerchant.tenant_id !== finalTenantId && req.user.role !== "SUPER_ADMIN") {
            return res.status(403).json({ success: false, message: "Unauthorized tenant scope" });
        }

        // Scope check for regular MERCHANT_ADMIN
        const merchantRole = req.user.roles?.find(r => r.scope === 'merchant');
        if (merchantRole && !currentMerchant.path.includes(merchantRole.scope_id)) {
            return res.status(403).json({ success: false, message: "Unauthorized merchant scope" });
        }

        // Prevent circular loops (can't make a merchant a child of itself or its own children)
        if (parent_id) {
            if (parent_id === id) return res.status(400).json({ success: false, message: "Cannot set merchant as its own parent" });
            const parentRes = await pool.query("SELECT path FROM merchants WHERE id = $1", [parent_id]);
            if (parentRes.rows.length === 0) return res.status(404).json({ success: false, message: "Parent not found" });

            const newParentPath = parentRes.rows[0].path;
            if (newParentPath.includes(id)) {
                return res.status(400).json({ success: false, message: "Circular hierarchy loop detected: Parent cannot be inside the current merchant's child tree." });
            }

            // Scope check on target parent
            if (merchantRole && !newParentPath.includes(merchantRole.scope_id)) {
                return res.status(403).json({ success: false, message: "Cannot move store outside of your authorized merchant scope." });
            }
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            // Apply straightforward updates (DB trigger automatically updates `path` for the moved merchant)
            const updateRes = await client.query(
                `UPDATE merchants 
                 SET name = COALESCE($1, name), 
                     parent_id = $2, 
                     external_id = COALESCE($3, external_id) 
                 WHERE id = $4 
                 RETURNING *`,
                [name || null, parent_id !== undefined ? parent_id : currentMerchant.parent_id, external_id || null, id]
            );

            const updatedMerchant = updateRes.rows[0];

            // If the parent changed, we must recursively fix the paths of ALL child merchants beneath it
            if (parent_id !== undefined && parent_id !== currentMerchant.parent_id) {
                const oldPrefix = currentMerchant.path;
                const newPrefix = updatedMerchant.path;

                await client.query(
                    `UPDATE merchants 
                     SET path = REPLACE(path, $1, $2) 
                     WHERE path LIKE $3 AND id != $4`,
                    [oldPrefix, newPrefix, `${oldPrefix}/%`, id]
                );
            }

            await client.query("COMMIT");
            res.json({ success: true, message: "Merchant updated successfully", data: updatedMerchant });
        } catch (txnErr) {
            await client.query("ROLLBACK");
            throw txnErr;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error("UpdateMerchant ERROR:", error);
        res.status(500).json({ message: "Server error", detail: error.message });
    }
};
