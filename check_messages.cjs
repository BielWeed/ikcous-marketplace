const fs = require('fs');
const lines = fs.readFileSync('C:/Users/Gabriel/.gemini/antigravity/scratch/telegram-bridge/antigravity-daemon.js', 'utf8').split('\n');
lines.forEach((l, i) => {
  if(l.includes('msg.chat.id') || l.includes('bot.sendMessage') || l.includes('sendMsg')) {
    console.log(`${i+1}: ${l.trim()}`);
  }
});
