const express = require("express");
const router = express.Router();
const { createMerchant, getMerchants, updateMerchant } = require("./merchant.controller");
const { verifyToken } = require("../../middleware/auth.middleware");
const { authorizeRoles } = require("../../middleware/role.middleware");

// Debug Role
router.get("/debug", verifyToken, (req, res) => res.json({ user: req.user }));

// Create Merchant
router.post(
    "/",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN", "MERCHANT_ADMIN"),
    createMerchant
);

// Get All Merchants
router.get(
    "/",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN", "MERCHANT_ADMIN"),
    getMerchants
);

// Update Merchant
router.put(
    "/:id",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN", "MERCHANT_ADMIN"),
    updateMerchant
);

module.exports = router;
