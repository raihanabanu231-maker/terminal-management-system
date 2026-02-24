const express = require("express");
const router = express.Router();
const { createMerchant, getMerchants } = require("./merchant.controller");
const { verifyToken } = require("../../middleware/auth.middleware");
const { authorizeRoles } = require("../../middleware/role.middleware");

// Create Merchant (Restricted to Super Admin)
router.post(
    "/",
    verifyToken,
    authorizeRoles("SUPER_ADMIN"),
    createMerchant
);

// Get All Merchants (Restricted to Super Admin & Tenant Admin)
router.get(
    "/",
    verifyToken,
    authorizeRoles("SUPER_ADMIN", "TENANT_ADMIN"),
    getMerchants
);

module.exports = router;
