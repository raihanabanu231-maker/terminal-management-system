const bcrypt = require("bcryptjs");

const password = process.argv[2];

if (!password) {
    console.log("Usage: node hash.js <password>");
    process.exit(1);
}

bcrypt.hash(password, 10, (err, hash) => {
    if (err) {
        console.error(err);
        return;
    }
    console.log("Hashed Password:", hash);
});
