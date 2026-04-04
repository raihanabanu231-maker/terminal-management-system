const pool = require("./src/config/db");

pool.query("SELECT * FROM enrollment_tokens LIMIT 1")
    .then(res => {
        console.log("COLUMNS:", Object.keys(res.rows[0] || {}));
        process.exit();
    })
    .catch(err => {
        console.error("ERROR:", err.message);
        process.exit();
    });
