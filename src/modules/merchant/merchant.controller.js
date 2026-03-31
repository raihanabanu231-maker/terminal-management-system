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

    // --- SUPPORT FOR SEARCHABLE HIERARCHY ---
    // If the user sends the Company (Tenant) ID as the parent_id, 
    // it means they want to create a first-level branch.
    // We treat it as internalParentId = NULL for the database.
    let internalParentId = parent_id;
    if (parent_id === finalTenantId) {
        internalParentId = null;
    }

    try {
        // --- UNIQUE NAME CHECK ---
        const duplicateCheckQuery = internalParentId
            ? "SELECT id FROM merchants WHERE name = $1 AND tenant_id = $2 AND parent_id = $3"
            : "SELECT id FROM merchants WHERE name = $1 AND tenant_id = $2 AND parent_id IS NULL";

        const queryParams = internalParentId
            ? [name, finalTenantId, internalParentId]
            : [name, finalTenantId];

        const duplicateRes = await pool.query(duplicateCheckQuery, queryParams);

        if (duplicateRes.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: internalParentId
                    ? `A branch named '${name}' already exists inside this Region.`
                    : `A top-level Region named '${name}' already exists for this Tenant.`
            });
        }

        const newId = crypto.randomUUID();
        let path = `${newId}`;

        // Fetch Tenant Name to prepend to name_path
        const tenantRes = await pool.query("SELECT name FROM tenants WHERE id = $1", [finalTenantId]);
        const tenantName = tenantRes.rows.length > 0 ? tenantRes.rows[0].name : "Unknown Tenant";
        let name_path = `${tenantName}/${name}`;

        if (internalParentId) {
            const parentRes = await pool.query("SELECT tenant_id, path, name_path FROM merchants WHERE id = $1", [internalParentId]);
            if (parentRes.rows.length === 0) {
                return res.status(404).json({ success: false, message: "Parent merchant not found" });
            }
            if (parentRes.rows[0].tenant_id !== finalTenantId) {
                return res.status(400).json({ success: false, message: "Parent merchant belongs to a different tenant" });
            }
            path = `${parentRes.rows[0].path}/${newId}`;
            name_path = parentRes.rows[0].name_path ? `${parentRes.rows[0].name_path}/${name}` : `${name}`;
        }

        // --- SECURITY PERMISSIONS CHECK ---
        const merchantRole = req.user.roles?.find(r => r.scope === 'merchant');
        const isTenantAdmin = req.user.role === 'TENANT_ADMIN';

        // Level 1: Super Admin -> No Restrictions
        if (req.user.role === 'SUPER_ADMIN') {
            // Full Access
        }
        // Level 2: Tenant Admin -> Can create anywhere in their Tenant
        else if (isTenantAdmin) {
            // Full Access within Tenant
        }
        // Level 3: Branch Admin / Merchant-Scoped -> RESTRICTED
        else if (merchantRole) {
            // A branch admin MUST provide a parent_id (they cannot create top-level/root branches)
            if (!internalParentId) {
                return res.status(403).json({
                    success: false,
                    message: "Permission Denied: Branch-level admins can only create sub-branches, not new top-level organizations."
                });
            }

            // The branch admin can ONLY create under their own authorized scope
            // We check if the 'path' of the parent they provided contains their own scope_id
            const userScopeId = merchantRole.scope_id;

            // Re-fetch parent info for the explicit scope check (just to be 100% safe)
            const parentCheck = await pool.query("SELECT id, path FROM merchants WHERE id = $1", [internalParentId]);
            if (parentCheck.rows.length === 0) {
                return res.status(404).json({ success: false, message: "Parent branch not found" });
            }

            const parentPath = parentCheck.rows[0].path;

            // Check if the parent is my own branch or a grandchild of my branch
            const isWithinMyScope = parentPath.split('/').includes(userScopeId);

            if (!isWithinMyScope) {
                return res.status(403).json({
                    success: false,
                    message: "Security Violation: You are not authorized to create branches outside of your own hierarchy scope."
                });
            }
        }
        // Other (Viewer, etc.)
        else {
            return res.status(403).json({ success: false, message: "Unauthorized: You do not have permission to create merchants." });
        }

        const result = await pool.query(
            `INSERT INTO merchants (id, name, tenant_id, parent_id, external_id, path, name_path) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             RETURNING *`,
            [newId, name, finalTenantId, internalParentId, external_id || null, path, name_path]
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
        // For Super Admin, if no tenant_id is provided in the query, we want to fetch EVERYTHING.
        // For others, we lock them to their own tenant_id from the token.
        const filterTenantId = (userRole === "SUPER_ADMIN")
            ? tenant_id
            : req.user.tenant_id;

        let query = `
            SELECT 
                m.*, 
                t.name as tenant_name,
                p.name as parent_name
            FROM merchants m 
            JOIN tenants t ON m.tenant_id = t.id
            LEFT JOIN merchants p ON m.parent_id = p.id
        `;
        const params = [];

        // Hierarchy Filtering Logic
        if (userRole === "SUPER_ADMIN") {
            if (filterTenantId) {
                params.push(filterTenantId);
                query += ` WHERE m.tenant_id = $${params.length} AND m.deleted_at IS NULL`;
            } else {
                query += ` WHERE m.deleted_at IS NULL`;
            }
        } else {
            // All non-super-admins are locked to their own tenant
            params.push(filterTenantId);
            query += ` WHERE m.tenant_id = $${params.length} AND m.deleted_at IS NULL`;

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

        const currentTenantId = filterTenantId || req.user.tenant_id;

        // Convert flat array to nested hierarchy tree
        const buildHierarchy = (merchants) => {
            const map = {};
            const roots = [];

            merchants.forEach(m => {
                map[m.id] = { ...m, children: [] };
            });

            merchants.forEach(m => {
                const parent = map[m.parent_id];
                if (m.parent_id && parent) {
                    parent.children.push(map[m.id]);
                } else {
                    roots.push(map[m.id]);
                }
            });

            return roots;
        };

        const simplifyTree = (nodes, currentLevel) => {
            return nodes.map(node => ({
                id: node.id,
                name: node.name,
                status: node.status || 'active', // Default to active if missing
                parent_id: node.parent_id || null,
                level: currentLevel,
                children: simplifyTree(node.children || [], currentLevel + 1)
            }));
        };

        const hierarchyData = buildHierarchy(result.rows);

        let rawTree = [];
        const merchantRole = req.user.roles?.find(r => r.scope === 'merchant');

        if (merchantRole) {
            // Level 3: Scoped to a branch
            rawTree = hierarchyData;
        } else if (userRole === "SUPER_ADMIN" && !tenant_id) {
            // Level 1: Global Super Admin View (Show ALL Tenants that HAVE merchants, plus potentially others)
            const allTenantsRes = await pool.query("SELECT id, name, status FROM tenants WHERE deleted_at IS NULL ORDER BY name ASC");
            rawTree = allTenantsRes.rows.map(t => ({
                id: t.id,
                name: t.name,
                status: t.status,
                parent_id: null,
                children: hierarchyData.filter(m => m.tenant_id === t.id)
            }));
        } else {
            // Level 2: Tenant Admin View (Show ONE Tenant as root)
            // Use currentTenantId which is either requested (Super) or forced (Tenant Admin)
            const tRes = await pool.query("SELECT name, status FROM tenants WHERE id = $1", [currentTenantId]);
            const rootName = tRes.rows[0]?.name || "Organization Not Found (Deleted)";
            const rootStatus = tRes.rows[0]?.status || "unknown";

            rawTree = [
                {
                    id: currentTenantId,
                    name: rootName,
                    status: rootStatus,
                    parent_id: null,
                    children: hierarchyData
                }
            ];
        }

        const cleanTree = simplifyTree(rawTree, 1);

        res.json({
            success: true,
            data: cleanTree
        });
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
            const parentRes = await pool.query("SELECT path, name_path FROM merchants WHERE id = $1", [parent_id]);
            if (parentRes.rows.length === 0) return res.status(404).json({ success: false, message: "Parent not found" });

            const newParentPath = parentRes.rows[0].path;
            const newParentNamePath = parentRes.rows[0].name_path || "";
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

            // --- LOCK THE RECORD FOR THE MOVE ---
            // This prevents race conditions if two admins try to move the same branch
            const lockRes = await client.query("SELECT * FROM merchants WHERE id = $1 FOR UPDATE", [id]);
            if (lockRes.rows.length === 0) throw new Error("Merchant disappeared");

            // Build new name_path if name or parent changed
            let calculatedNamePath = currentMerchant.name_path;
            let finalName = name || currentMerchant.name;

            if (parent_id !== undefined || name) {
                if (parent_id) {
                    const parentData = await client.query("SELECT name_path FROM merchants WHERE id = $1", [parent_id]);
                    calculatedNamePath = parentData.rows[0].name_path ? `${parentData.rows[0].name_path}/${finalName}` : finalName;
                } else if (parent_id === null) {
                    calculatedNamePath = finalName; // moved to root
                } else {
                    // name changed but parent didn't
                    const parts = currentMerchant.name_path ? currentMerchant.name_path.split('/') : [];
                    parts.pop();
                    parts.push(finalName);
                    calculatedNamePath = parts.join('/');
                }
            }

            // Apply straightforward updates (DB trigger automatically updates `path` for the moved merchant)
            const updateRes = await client.query(
                `UPDATE merchants 
                 SET name = COALESCE($1, name), 
                     parent_id = $2, 
                     external_id = COALESCE($3, external_id),
                     name_path = $4
                 WHERE id = $5 
                 RETURNING *`,
                [name || null, parent_id !== undefined ? parent_id : currentMerchant.parent_id, external_id || null, calculatedNamePath, id]
            );

            const updatedMerchant = updateRes.rows[0];

            // If the parent or name changed, we must recursively fix the paths of ALL child merchants beneath it
            if ((parent_id !== undefined && parent_id !== currentMerchant.parent_id) || name) {
                const oldPrefix = currentMerchant.path;
                const newPrefix = updatedMerchant.path;
                const oldNamePrefix = currentMerchant.name_path;
                const newNamePrefix = updatedMerchant.name_path;

                // --- SAFER ANCHORED REPLACEMENT ---
                // We use string concatenation to replace ONLY the start of the path
                // This prevents accidental replacement of UUID substrings
                if (oldPrefix !== newPrefix) {
                    await client.query(
                        `UPDATE merchants 
                         SET path = $1 || SUBSTRING(path FROM $2) 
                         WHERE path LIKE $3 AND id != $4`,
                        [newPrefix, oldPrefix.length + 1, `${oldPrefix}/%`, id]
                    );
                }

                // Update Name paths (Anchored replacement)
                if (oldNamePrefix !== newNamePrefix) {
                    await client.query(
                        `UPDATE merchants 
                         SET name_path = $1 || SUBSTRING(name_path FROM $2) 
                         WHERE path LIKE $3 AND id != $4`,
                        [newNamePrefix, oldNamePrefix.length + 1, `${newPrefix}/%`, id]
                    );
                }
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

// Delete a Merchant (⚠️ This will cascade and delete all nested child locations)
exports.deleteMerchant = async (req, res) => {
    const { id } = req.params;
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

        // Prevent users from deleting their own administrative root node
        if (merchantRole && currentMerchant.id === merchantRole.scope_id) {
            return res.status(403).json({ success: false, message: "Access Denied: You cannot delete the root Merchant of your own administrative scope." });
        }

        // Soft Delete the entire subtree using the path
        await pool.query(
            "UPDATE merchants SET deleted_at = NOW() WHERE path LIKE $1 || '%' AND deleted_at IS NULL",
            [currentMerchant.path]
        );

        res.json({ success: true, message: "Merchant and all child locations soft-deleted successfully" });
    } catch (error) {
        console.error("DeleteMerchant ERROR:", error);
        res.status(500).json({ message: "Server error", detail: error.message });
    }
};
