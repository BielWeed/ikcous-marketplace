const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync('eslint_report.json', 'utf8'));
const counts = {};
const specificErrors = [];

for (const file of report) {
    for (const msg of file.messages) {
        counts[msg.ruleId] = (counts[msg.ruleId] || 0) + 1;
        if (msg.ruleId !== '@typescript-eslint/no-explicit-any' && msg.ruleId !== '@typescript-eslint/no-unused-vars' && msg.ruleId !== 'prefer-const') {
            specificErrors.push(`${file.filePath}:${msg.line}:${msg.column} - ${msg.ruleId} - ${msg.message}`);
        }
    }
}

console.log('Rule counts:', counts);
console.log('Specific errors:');
specificErrors.forEach(err => console.log(err));
