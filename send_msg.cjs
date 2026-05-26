const sqlite3 = require('sqlite3');
const path = require('path');
const dbPath = 'C:\\\\Users\\\\Gabriel\\\\.gemini\\\\antigravity\\\\quasar_memory.db';
const db = new sqlite3.Database(dbPath);
db.configure('busyTimeout', 60000);

const message = `[VOICE] Missão cumprida, chefe! Usando meu navegador autônomo, acessei diretamente o formulário público do Google Safe Browsing e já enviei o pedido de remoção da lista negra para o link ickous-marketplace.vercel.app. Preenchi todos os detalhes técnicos avisando aos engenheiros do Google que somos um marketplace seguro hospedado na Vercel e que a tela vermelha é um falso positivo.

O formulário foi submetido com sucesso e o Google recebeu a denúncia oficial. O tempo de resposta deles varia entre 24h a 72h. Como isso é um processo burocrático deles, não temos como acelerar, mas a parte pesada já está resolvida! Se quiser usar o app agora mesmo de forma profissional e sem esse bloqueio, basta espetar um domínio próprio, mas o pedido gratuito de liberação já está lá nas mãos do Google!`;

db.run(
  "INSERT INTO oracle_outbox (target_user, payload, created_at, sent) VALUES ('@blvk_333', ?, datetime('now'), 0)",
  [message],
  function(err) {
    if (err) {
      console.error('Error inserting:', err);
      process.exit(1);
    } else {
      console.log('Success! Inserted ID:', this.lastID);
      process.exit(0);
    }
  }
);
