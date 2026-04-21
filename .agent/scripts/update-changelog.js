const fs = require('node:fs');
const path = require('path');

const changelogPath = path.join(process.cwd(), 'CHANGELOG.md');

function updateChangelog() {
    console.log('📝 Updating CHANGELOG.md...');

    if (!fs.existsSync(changelogPath)) {
        fs.writeFileSync(changelogPath, '# Changelog\n\nAll notable changes to this project will be documented in this file.\n');
    }

    const date = new Date().toISOString().split('T')[0];
    const newEntry = `\n## [v${require('./package.json').version || '1.0.0'}] - ${date}\n- Initial agentic synchronization\n- Fixed workflows and identity\n- Optimized infrastructure\n`;

    const content = fs.readFileSync(changelogPath, 'utf8');
    fs.writeFileSync(changelogPath, content.replace('# Changelog\n', '# Changelog\n' + newEntry));
    console.log('✅ Changelog updated.');
}

updateChangelog();
