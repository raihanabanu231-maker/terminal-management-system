require("dotenv").config();
const pool = require("./src/config/db");

async function checkDeviceSchema() {
    try {
        const res = await pool.query(`SELECT * FROM devices LIMIT 0`);
        console.log("Device Columns:", res.fields.map(f => f.name));
        pool.end();
    } catch (err) {
        console.error(err);
    }
}

checkDeviceSchema();
