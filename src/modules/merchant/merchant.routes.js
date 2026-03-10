const express = require("express");
const router = express.Router();
const { createMerchant, getMerchants, updateMerchant, deleteMerchant } = require("./merchant.controller");
const { verifyToken } = require("../../middleware/auth.middleware");
const { authorizeRoles } = require("../../middleware/role.middleware");

// Debug Role
router.get("/debug", verifyToken, (req, res) => res.json({ user: req.user }));

// Create Merchant
router.post(
    "/",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN"),
    createMerchant
);

// Get All Merchants
router.get(
    "/",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN", "OPERATOR", "VIEWER"),
    getMerchants
);

// Update Merchant
router.put(
    "/:id",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN"),
    updateMerchant
);

// Delete Merchant
router.delete(
    "/:id",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN"),
    deleteMerchant
);

module.exports = router;
