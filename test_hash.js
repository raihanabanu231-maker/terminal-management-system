const crypto = require('crypto');

const rawToken = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // 64 chars
const hash = crypto.createHash('sha256').update(rawToken).digest('hex');

console.log('Raw Token:', rawToken);
console.log('Hash:', hash);

const trimmedHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
console.log('Trimmed Hash:', trimmedHash);
极端
