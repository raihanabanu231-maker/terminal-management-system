const bcrypt = require("bcrypt");

exports.hashPassword = async (password) => {
    const salt = await bcrypt.genSalt(10);
    return await bcrypt.hash(password, salt);
};

exports.comparePassword = async (enteredPassword, storedPassword) => {
    return await bcrypt.compare(enteredPassword, storedPassword);
};
