const fs = require('fs');
try {
    const data = fs.readFileSync('debug_out.txt', 'utf16le');
    console.log(data);
} catch (e) {
    const data = fs.readFileSync('debug_out.txt', 'utf8');
    console.log(data);
}
