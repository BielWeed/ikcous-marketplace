#!/usr/bin/env node
/**
 * Atualiza a senha do banco nos arquivos .env locais depois de uma rotação no
 * painel do Supabase.
 *
 * A senha é lida do terminal com o eco desligado: nunca aparece na tela, nunca
 * vai pra history do shell, nunca é impressa em log. O único lugar onde ela é
 * escrita são os arquivos .env, que já estão no .gitignore.
 *
 * Uso:  node scripts/rotate-db-password.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-unsafe-regex, security/detect-possible-timing-attacks --
 * As 8 ocorrências do eslint-plugin-security neste arquivo são falso-positivo, e
 * silenciá-las aqui é melhor que subir o teto da catraca, que valeria pro repo inteiro:
 *
 * - detect-non-literal-fs-filename (4x): os caminhos vêm de TARGETS, uma constante deste
 *   arquivo, resolvida contra ROOT. Não há entrada de usuário no nome do arquivo.
 * - detect-unsafe-regex (3x): as regex leem UMA linha de um .env local do próprio dev.
 *   Não há entrada de rede, não há atacante, e o processo é de vida curta.
 * - detect-possible-timing-attacks (1x): a comparação é entre a senha digitada e a
 *   confirmação digitada pela MESMA pessoa, no mesmo processo, sem canal remoto.
 *
 * Se este script um dia receber caminho por argumento ou rodar em servidor, tire este
 * bloco e trate cada aviso de verdade.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

// Só os arquivos que realmente carregam a connection string. Os demais .env do
// projeto têm DATABASE_URL="" e não precisam de nada.
const TARGETS = [".env", ".env.vercel.pulled"];

/** Lê uma linha do stdin sem ecoar os caracteres digitados. */
function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      reject(
        new Error(
          "stdin não é um terminal — rode este script direto no terminal, sem pipe.",
        ),
      );
      return;
    }

    stdout.write(question);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    const ENTER = ["\r", "\n", "\u0004"]; // Enter, newline, Ctrl-D
    const CANCEL = "\u0003"; // Ctrl-C
    const ERASE = ["\u007f", "\b"]; // Delete, Backspace

    let value = "";
    const finish = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write("\n");
    };
    const onData = (chunk) => {
      // Colar a senha entrega vários caracteres num chunk só, então trata char por char.
      for (const char of chunk.toString("utf8")) {
        if (ENTER.includes(char)) {
          finish();
          resolve(value);
          return;
        }
        if (char === CANCEL) {
          finish();
          reject(new Error("cancelado"));
          return;
        }
        if (ERASE.includes(char)) {
          value = value.slice(0, -1);
          continue;
        }
        if (char >= " ") value += char; // ignora demais caracteres de controle
      }
    };
    stdin.on("data", onData);
  });
}

/**
 * Reconstrói a connection string trocando apenas a senha.
 *
 * Não tenta "achar onde a senha termina" na string antiga — isso é ambíguo
 * quando a senha contém `@` ou `:`, que é exatamente o caso deste projeto hoje.
 * Em vez disso extrai usuário (antes do primeiro `:`) e o destino (depois do
 * ÚLTIMO `@`), e monta de novo com a senha nova codificada.
 */
function replacePassword(url, newPassword) {
  const schemeEnd = url.indexOf("://");
  if (schemeEnd === -1)
    throw new Error(`connection string sem esquema: ${url.slice(0, 20)}…`);

  const scheme = url.slice(0, schemeEnd);
  const rest = url.slice(schemeEnd + 3);

  const lastAt = rest.lastIndexOf("@");
  if (lastAt === -1)
    throw new Error('connection string sem "@" — formato inesperado');

  const credentials = rest.slice(0, lastAt);
  const destination = rest.slice(lastAt + 1);

  const firstColon = credentials.indexOf(":");
  const user =
    firstColon === -1 ? credentials : credentials.slice(0, firstColon);
  if (!user)
    throw new Error("não consegui identificar o usuário na connection string");

  return `${scheme}://${user}:${encodeURIComponent(newPassword)}@${destination}`;
}

/** Troca a senha na linha DATABASE_URL preservando o estilo de aspas do arquivo. */
function rewriteLine(line, newPassword) {
  const match = line.match(
    /^(\s*(?:export\s+)?DATABASE_URL\s*=\s*)(["']?)(.*?)\2\s*$/,
  );
  if (!match) return null;

  const [, prefix, quote, value] = match;
  if (!value) return null; // DATABASE_URL="" — nada a fazer

  return `${prefix}${quote}${replacePassword(value, newPassword)}${quote}`;
}

async function testConnection(connectionString) {
  let Client;
  try {
    ({ Client } = require("pg"));
  } catch {
    return {
      ok: null,
      detail: 'pacote "pg" não encontrado — pulei o teste de conexão',
    };
  }

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 15000,
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      "select current_user, current_database()",
    );
    await client.end();
    return {
      ok: true,
      detail: `conectou como ${rows[0].current_user} em ${rows[0].current_database}`,
    };
  } catch (error) {
    try {
      await client.end();
    } catch {
      /* já caiu */
    }
    return { ok: false, detail: error.message };
  }
}

async function main() {
  console.log("\nRotação da senha do banco — IKCOUS Marketplace\n");
  console.log(
    "Cole a senha nova que o Supabase gerou. Ela não vai aparecer na tela.",
  );
  console.log("(Ctrl-C cancela sem alterar nada.)\n");

  const password = await promptHidden("Senha nova: ");
  if (!password) {
    console.error("\nNenhuma senha informada. Nada foi alterado.");
    process.exitCode = 1;
    return;
  }

  const confirmation = await promptHidden("Digite de novo pra confirmar: ");
  if (password !== confirmation) {
    console.error("\nAs duas não batem. Nada foi alterado — rode de novo.");
    process.exitCode = 1;
    return;
  }

  // Fase 1: calcula tudo em memória antes de escrever qualquer arquivo, pra não
  // deixar metade atualizada se algo falhar no meio.
  const planned = [];
  for (const name of TARGETS) {
    const filePath = path.join(ROOT, name);
    if (!fs.existsSync(filePath)) {
      console.log(`  · ${name} — não existe, pulando`);
      continue;
    }

    const original = fs.readFileSync(filePath, "utf8");
    const eol = original.includes("\r\n") ? "\r\n" : "\n";
    const lines = original.split(/\r?\n/);

    let changed = false;
    const updated = lines.map((line) => {
      const rewritten = rewriteLine(line, password);
      if (rewritten === null) return line;
      changed = true;
      return rewritten;
    });

    if (!changed) {
      console.log(`  · ${name} — sem DATABASE_URL com valor, pulando`);
      continue;
    }

    planned.push({ name, filePath, content: updated.join(eol) });
  }

  if (planned.length === 0) {
    console.error("\nNenhum arquivo pra atualizar. Nada foi alterado.");
    process.exitCode = 1;
    return;
  }

  // Fase 2: backup e escrita.
  for (const { name, filePath, content } of planned) {
    fs.copyFileSync(filePath, `${filePath}.bak`);
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`  ✓ ${name} atualizado (backup em ${name}.bak)`);
  }

  // Fase 3: prova real — conecta usando o que acabou de ser escrito.
  console.log("\nTestando a conexão com a senha nova…");
  const envPath = path.join(ROOT, ".env");
  const line = fs
    .readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((l) => /^\s*(?:export\s+)?DATABASE_URL\s*=/.test(l));
  const connectionString = line
    ?.replace(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*/, "")
    .replace(/^["']|["']$/g, "");

  const result = await testConnection(connectionString);
  if (result.ok === true) {
    console.log(`  ✓ ${result.detail}`);
    console.log(
      "\nPronto. Os arquivos locais estão com a senha nova e o banco aceitou.",
    );
    console.log(
      "Falta só a Vercel — veja docs/runbooks/rotacao-credenciais-supabase.md.",
    );
    console.log("Quando confirmar que tudo funciona, apague os arquivos .bak.");
  } else if (result.ok === null) {
    console.log(`  · ${result.detail}`);
  } else {
    console.error(`  ✗ o banco recusou: ${result.detail}`);
    console.error(
      "\nOs arquivos FORAM alterados. Se a senha estiver errada, restaure com:",
    );
    for (const { name } of planned)
      console.error(`    copy "${name}.bak" "${name}"`);
    process.exitCode = 1;
  }
}

// Só executa quando chamado direto — permite testar replacePassword/rewriteLine.
if (require.main === module) {
  main().catch((error) => {
    console.error(`\nErro: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { replacePassword, rewriteLine };
