require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function testPolicy() {
   const deviceId = 'a314501f-2c31-4a1c-97e5-27484179cba9'; // Our active test device
   const merchantId = '64051f66-9591-455c-a144-d948c4ffa745'; // Testing 50 B1
   const tenantId = '7d547cb7-b8fd-40ab-9097-6f890563c77d'; // Testing 50

   try {
      console.log("🧪 Stage 1: Testing Merchant-level DISABLE...");
      // 1. Force Merchant Disable
      await pool.query("UPDATE merchants SET audit_logging_enabled = false WHERE id = $1", [merchantId]);

      // 2. Fetch Policy via the same query used in Controller
      const res1 = await pool.query(`
            SELECT t.audit_logging_enabled as t_audit, m.audit_logging_enabled as m_audit
            FROM devices d
            JOIN tenants t ON d.tenant_id = t.id
            LEFT JOIN merchants m ON d.merchant_id = m.id
            WHERE d.id = $1`, [deviceId]);

      const dev1 = res1.rows[0];
      const isEnabled1 = dev1.m_audit !== null ? dev1.m_audit : (dev1.t_audit !== null ? dev1.t_audit : true);
      console.log(`🔍 Result: merchant_audit=${dev1.m_audit}, tenant_audit=${dev1.t_audit} => Resolved Policy: ${isEnabled1}`);

      console.log("\n🧪 Stage 2: Testing Merchant-level INHERIT (null) while Tenant is ENABLED...");
      // 1. Set Merchant to null (inherit)
      await pool.query("UPDATE merchants SET audit_logging_enabled = NULL WHERE id = $1", [merchantId]);
      await pool.query("UPDATE tenants SET audit_logging_enabled = true WHERE id = $1", [tenantId]);

      const res2 = await pool.query(`
            SELECT t.audit_logging_enabled as t_audit, m.audit_logging_enabled as m_audit
            FROM devices d
            WHERE d.id = $1`, [deviceId]); // We'd join again in reality but simulating logic

      // (Re-running full join for accuracy)
      const res2Full = await pool.query(`
            SELECT t.audit_logging_enabled as t_audit, m.audit_logging_enabled as m_audit
            FROM devices d
            JOIN tenants t ON d.tenant_id = t.id
            LEFT JOIN merchants m ON d.merchant_id = m.id
            WHERE d.id = $1`, [deviceId]);

      const dev2 = res2Full.rows[0];
      const isEnabled2 = dev2.m_audit !== null ? dev2.m_audit : (dev2.t_audit !== null ? dev2.t_audit : true);
      console.log(`🔍 Result: merchant_audit=${dev2.m_audit}, tenant_audit=${dev2.t_audit} => Resolved Policy: ${isEnabled2}`);

   } catch (err) {
      console.error("❌ TEST FAILED:", err.message);
   } finally {
      // Clean up
      await pool.query("UPDATE merchants SET audit_logging_enabled = NULL WHERE id = $1", [merchantId]);
      await pool.end();
   }
}
testPolicy();
