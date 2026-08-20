#!/usr/bin/env node
// Script de PROVA: monta um repositório descartável num caminho calculado em
// tempo de execução (raiz do git + `scratch/` + o PID) e lê o hook que o
// próprio git resolveu. Caminho não-literal não é descuido aqui — é a razão de
// o script existir. Nenhum vem de entrada externa: todos saem de
// `git rev-parse` e de `process.pid`.
/* eslint-disable security/detect-non-literal-fs-filename */
/**
 * Prova que a trava de `pre-commit` está LIGADA e falha FECHADO.
 *
 * Por que este script existe: até 20/08/2026 o hook estava desligado em
 * silêncio dentro de `git worktree`. O `.git/hooks/pre-commit` é gerado pelo
 * lefthook e compartilhado por todos os worktrees; o shim procurava o binário
 * em `$(git rev-parse --show-toplevel)/node_modules`, que dentro de um
 * worktree é a pasta do worktree — e 3 dos 5 não têm `node_modules`. O último
 * ramo do shim fazia `echo "Can't find lefthook in PATH"` e ACABAVA, sem
 * `exit 1`: o git lia 0 e aprovava o commit. A mensagem saía no meio de uma
 * saída de sucesso e passava por ruído.
 *
 * "O hook está instalado" não prova nada — foi exatamente isso que o
 * CONTRIBUTING.md afirmava enquanto a trava estava desligada. Então aqui cada
 * afirmação é medida, com controle positivo e negativo NA MESMA RODADA:
 *
 *   0. EM USO     os TRÊS hooks que o git VAI executar nesta árvore
 *                 (`pre-commit`, `commit-msg` e `pre-push`) têm as
 *                 propriedades que a config ATUAL gera?
 *   1. POSITIVO   segredo falso staged  -> commit RECUSADO e o secretlint é
 *                                          nomeado na saída
 *   2. NEGATIVO   o MESMO arquivo limpo -> commit PASSA, e o secretlint
 *                                          continua sendo nomeado (senão um
 *                                          hook que não roda nada "aprova")
 *      (1 e 2 rodam de dentro de um `git worktree`, que é onde a trava estava
 *      desligada; o caminho absoluto deles tem espaços, como o do projeto.)
 *   3. ANTES      shim gerado da MESMA config, só sem as duas chaves de topo,
 *                 com o lefthook fora de alcance -> exit 0  (o bug histórico)
 *   4. DEPOIS     shim gerado da config ATUAL, mesmo cenário -> exit != 0
 *   5. ESPAÇO     shim com `--git-common-dir` mas SEM `--path-format=relative`,
 *                 rodado de um worktree -> quebra, porque o lefthook emite o
 *                 valor sem aspas e o caminho absoluto tem espaço
 *
 * O controle 3 é o que dá lastro ao 4: sem ele, "exit != 0" poderia ser
 * qualquer coisa quebrada, e não a trava funcionando.
 *
 * O controle 0 existe porque os controles 1 a 5 medem a CONFIGURAÇÃO: eles
 * instalam hooks num repositório descartável e provam que aquele arranjo
 * fecha. Isso não diz nada sobre os hooks que o git executa NESTA árvore — e
 * em 20/08/2026 os dois estavam divergentes enquanto o script dizia
 * "5 de 5 PASSOU". O `.git/hooks` é COMPARTILHADO por todos os worktrees, e
 * o lefthook o reescreve sozinho quando o checksum do `lefthook.yml` da
 * árvore de onde se commitou não bate. Enquanto existir worktree em branch
 * sem estas chaves, um commit feito de lá reverte o hook de todo mundo.
 * Sem o controle 0, este script seria a segunda ferramenta a afirmar sucesso
 * sem ter medido o que importa — que é o defeito que ele nasceu para matar.
 *
 * E ele olha os TRÊS hooks, não só o `pre-commit`: o mesmo fail-open atinge o
 * `commit-msg` (commitlint) e o `pre-push`, e o `pre-push` carrega o
 * `guarda-de-branch`, que é a única barreira que resta contra push direto em
 * main/develop — branch protection não existe neste plano do GitHub. Medir um
 * dos três e falar dos três seria o mesmo erro de escopo de novo.
 *
 * Nada é escrito na árvore de verdade. O repositório descartável nasce dentro
 * de `scratch/`, que é ignorado pelo git — e isso é CONFERIDO com
 * `git check-ignore` antes de qualquer arquivo ser criado, porque lixo visível
 * numa árvore compartilhada com outras sessões vira alerta órfão. O script não
 * usa `git stash`, `checkout`, `restore`, `clean` nem `reset` em lugar nenhum.
 *
 * Uso: npm run hooks:prova
 */

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join, resolve } from "node:path";

// --------------------------------------------------------------------------
// Utilidades
// --------------------------------------------------------------------------

/**
 * Aborto controlado da prova.
 *
 * Existe porque `process.exit()` NÃO roda o `finally` — e parte dos abortos
 * acontece depois de o repositório descartável já ter sido criado. Saindo por
 * exceção, a limpeza continua valendo e nada fica largado em `scratch/`, que é
 * uma pasta de uma árvore compartilhada com outras sessões.
 */
class ProvaAbortada extends Error {}

/** Roda um comando e devolve {code, saida} com stdout e stderr juntos. */
function roda(cmd, args, opcoes = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    windowsHide: true,
    ...opcoes,
  });
  const saida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.error) return { code: -1, saida: `${saida}${r.error.message}` };
  return { code: r.status ?? -1, saida };
}

/** Roda e explode se falhar: é montagem de arranjo, não é o que se mede. */
function exige(cmd, args, opcoes = {}) {
  const r = roda(cmd, args, opcoes);
  if (r.code !== 0) {
    throw new Error(
      `arranjo falhou: ${cmd} ${args.join(" ")}\n(exit ${r.code})\n${r.saida}`,
    );
  }
  return r;
}

/**
 * O PATH sem `node_modules` é o que dá validade aos controles 1 e 2.
 *
 * `npm run` põe `<projeto>/node_modules/.bin` no PATH do processo. Com isso o
 * ramo `lefthook.exe -h` do shim acha o binário sozinho e o hook funciona
 * MESMO com a configuração quebrada — medido em 20/08/2026: com as duas chaves
 * removidas o controle 1 continuava verde. Ou seja, rodar a prova por
 * `npm run` estava emprestando ao hook um alcance que a pessoa NÃO tem quando
 * commita do terminal dela. Tirando essas entradas, o commit exercita a
 * resolução de verdade.
 *
 * `NO_COLOR` porque o lefthook desenha a moldura com escape ANSI de 24 bits
 * por caractere: sem isso a saída vira parede de código de cor e o veredito se
 * perde no meio. Quem lê isto está decidindo se confia na trava.
 */
const PATH_SEM_NODE_MODULES = (process.env.PATH ?? "")
  .split(delimiter)
  .filter((p) => p && !/node_modules/i.test(p))
  .join(delimiter);

function git(args, cwd) {
  return roda("git", args, {
    cwd,
    env: { ...process.env, PATH: PATH_SEM_NODE_MODULES, NO_COLOR: "1" },
  });
}

function gitExige(args, cwd) {
  return exige("git", args, { cwd });
}

const secao = (t) => console.log(`\n${"─".repeat(74)}\n${t}\n`);

// --------------------------------------------------------------------------
// Onde o `sh` mora — o shim é `#!/bin/sh` e os controles 3, 4 e 5 precisam
// rodá-lo com o PATH sob controle. Achar o interpretador NÃO pode depender do
// PATH que estamos justamente esvaziando.
// --------------------------------------------------------------------------

function acharSh() {
  for (const p of (process.env.PATH ?? "").split(delimiter)) {
    if (!p) continue;
    for (const nome of ["sh.exe", "sh"]) {
      const candidato = join(p, nome);
      if (existsSync(candidato)) return candidato;
    }
  }
  // Git para Windows: sh.exe fica em <git>/usr/bin, e --exec-path aponta para
  // <git>/mingw64/libexec/git-core. Sobe três níveis e desce em usr/bin.
  const execPath = roda("git", ["--exec-path"]);
  if (execPath.code === 0) {
    const derivado = resolve(
      execPath.saida.trim(),
      "..",
      "..",
      "..",
      "usr",
      "bin",
      "sh.exe",
    );
    if (existsSync(derivado)) return derivado;
  }
  return null;
}

// --------------------------------------------------------------------------
// O segredo falso. Gerado aqui, nunca lido de arquivo: um script de prova que
// carrega credencial de verdade é o próprio incidente que ele deveria pegar.
//
// O formato é uma URL de conexão PostgreSQL com senha — que é exatamente o
// que já foi commitado neste repositório (ver .gitignore, regra `*.bak`).
// A regra que pega é @secretlint/secretlint-rule-database-connection-string.
//
// ATENÇÃO, medido em 20/08/2026: um JWT no formato `service_role` do Supabase
// NÃO é detectado pelo preset-recommend (secretlint 13.0.4) — testado, saiu
// com exit 0. A trava pega senha de banco, não pega chave de Supabase. Isso é
// buraco de cobertura do secretlint, não deste script, e está fora do escopo
// desta tarefa; a prova usa um formato que o preset REALMENTE detecta, senão
// o controle positivo estaria provando o próprio instrumento quebrado.
// --------------------------------------------------------------------------

function segredoFalso() {
  const senha = `senhaFalsaDeTeste${Date.now().toString(36)}`;
  return `DATABASE_URL=postgresql://postgres:${senha}@db.exemplo-que-nao-existe.supabase.co:5432/postgres`;
}

const LINHA_LIMPA =
  "DATABASE_URL=postgresql://postgres:${SENHA_VEM_DO_AMBIENTE}@db.exemplo.local:5432/postgres";

// --------------------------------------------------------------------------
// Arranjo
// --------------------------------------------------------------------------

const RAIZ = gitExige(["rev-parse", "--show-toplevel"]).saida.trim();
const COMMON_DIR = gitExige(
  ["rev-parse", "--git-common-dir"],
  RAIZ,
).saida.trim();
const LEFTHOOK_REAL = resolve(
  RAIZ,
  COMMON_DIR,
  "..",
  "node_modules",
  ".bin",
  "lefthook",
);
/**
 * `node_modules/.bin/lefthook` é um script `sh`, e o `spawnSync` do Node no
 * Windows não executa isso (ENOENT). Como o script já depende de um `sh` para
 * rodar o shim, é por ele que o lefthook é invocado — em vez de adivinhar qual
 * pacote `lefthook-<os>-<arch>` foi instalado nesta máquina.
 */
const LEFTHOOK_POSIX = LEFTHOOK_REAL.replace(/\\/g, "/");
function rodaLefthook(args, cwd) {
  return exige(SH, ["-c", `"${LEFTHOOK_POSIX}" ${args.join(" ")}`], { cwd });
}

const RELATIVO_TEMP = `scratch/hooks-prova-${process.pid}`;
const TEMP = join(RAIZ, "scratch", `hooks-prova-${process.pid}`);

/**
 * Cria um repositório descartável com hooks instalados, mais um worktree dele.
 * `ajustaYml` recebe o lefthook.yml real e devolve a variante daquele cenário.
 */
function montarRepo(nome, ajustaYml) {
  const repo = join(TEMP, nome);
  const wt = join(TEMP, `${nome}-wt`);
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(join(repo, "node_modules", ".bin"), { recursive: true });

  const yml = ajustaYml(readFileSync(join(RAIZ, "lefthook.yml"), "utf8"));
  writeFileSync(join(repo, "lefthook.yml"), yml);
  copyFileSync(
    join(RAIZ, ".secretlintrc.json"),
    join(repo, ".secretlintrc.json"),
  );
  copyFileSync(
    join(RAIZ, ".secretlintignore"),
    join(repo, ".secretlintignore"),
  );
  copyFileSync(
    join(RAIZ, "scripts", "guarda-de-branch.mjs"),
    join(repo, "scripts", "guarda-de-branch.mjs"),
  );

  // Stand-in do `node_modules/.bin/lefthook`: aqui não roda `npm install`, e o
  // que o shim precisa é que o caminho que ele monta chegue a um executável.
  // O caminho real vai ENTRE ASPAS aqui dentro de propósito — quem tem de
  // sobreviver ao espaço sem aspas é o shim, e é isso que os controles medem.
  writeFileSync(
    join(repo, "node_modules", ".bin", "lefthook"),
    `#!/bin/sh\nexec "${LEFTHOOK_POSIX}" "$@"\n`,
    { mode: 0o755 },
  );

  gitExige(["init", "-q", "-b", "prova-da-trava", repo]);
  gitExige(["config", "user.name", "prova"], repo);
  gitExige(["config", "user.email", "prova@exemplo.invalido"], repo);
  gitExige(["config", "commit.gpgsign", "false"], repo);
  gitExige(["add", "-A"], repo);
  gitExige(["commit", "-q", "-m", "chore: arranjo da prova"], repo);

  rodaLefthook(["install"], repo);

  // A prova é do `pre-commit`. `commit-msg` (commitlint) e `pre-push` sairiam
  // do arranjo e reprovariam por outro motivo, poluindo o controle.
  for (const h of ["commit-msg", "pre-push"]) {
    const caminho = join(repo, ".git", "hooks", h);
    if (existsSync(caminho)) rmSync(caminho, { force: true });
  }

  gitExige(["worktree", "add", "-q", wt], repo);
  return { repo, wt, hook: join(repo, ".git", "hooks", "pre-commit") };
}

/**
 * Os hooks que este `lefthook.yml` define. Os três saem do MESMO gerador, vão
 * para o MESMO `.git/hooks` compartilhado e sofreram o MESMO fail-open — então
 * medir só o `pre-commit` deixaria de fora o `commit-msg` (commitlint) e o
 * `pre-push`, que é quem segura push direto em main/develop.
 */
const HOOKS = ["pre-commit", "commit-msg", "pre-push"];

/**
 * O caminho do hook `nome` que o git VAI executar nesta árvore.
 *
 * Dentro de um worktree ele NÃO fica em `<worktree>/.git/hooks`: o `.git` do
 * worktree é um arquivo apontando para a árvore principal, e é lá que os hooks
 * moram. `--git-path` é quem resolve isso corretamente de qualquer uma das
 * árvores — montar o caminho na mão erraria justamente onde a trava falhou.
 */
function caminhoDoHookEmUso(nome) {
  const r = git(["rev-parse", "--git-path", `hooks/${nome}`], RAIZ);
  if (r.code !== 0) return null;
  const caminho = r.saida.trim();
  return caminho === "" ? null : resolve(RAIZ, caminho);
}

/**
 * Gera, num repositório descartável, os shims que a configuração ATUAL produz.
 * São a referência contra a qual os hooks em uso são comparados — assim o
 * controle 0 não depende de uma cópia do shim escrita à mão, que envelheceria
 * calada.
 *
 * Devolve um `Map` de hook -> texto (ou `null`). `null` quer dizer que o
 * `lefthook install` NÃO gerou aquele hook a partir desta config, o que é um
 * estado inesperado e não pode ser lido como sucesso.
 *
 * `Map` e não objeto: indexar objeto por chave calculada acende o
 * `security/detect-object-injection` do eslint, e warning novo reprova a
 * catraca igual a erro novo.
 */
function shimsDeReferencia() {
  const repo = join(TEMP, "referencia");
  mkdirSync(repo, { recursive: true });
  copyFileSync(join(RAIZ, "lefthook.yml"), join(repo, "lefthook.yml"));
  gitExige(["init", "-q", "-b", "referencia", repo]);
  rodaLefthook(["install"], repo);
  /** @type {Map<string, string | null>} */
  const textos = new Map();
  for (const nome of HOOKS) {
    const caminho = join(repo, ".git", "hooks", nome);
    textos.set(
      nome,
      existsSync(caminho) ? readFileSync(caminho, "utf8") : null,
    );
  }
  return textos;
}

/**
 * As duas propriedades que separam um shim que TRAVA de um que aprova em
 * silêncio. Medidas no TEXTO do shim: a configuração é o que se pretende, o
 * shim é o que roda, e foi a distância entre os dois que passou batido.
 *
 * - `resolvePelaPrincipal`: tem o ramo que acha o binário pelo `.git` da
 *   árvore principal. Sem ele o shim procura em `--show-toplevel`, que dentro
 *   de um worktree é uma pasta sem `node_modules`.
 * - `falhaFechado`: o ramo final (o `else` do "Can't find lefthook in PATH")
 *   termina em `exit 1` em vez de escorregar para o sucesso.
 */
function perfilDoShim(texto) {
  const t = String(texto ?? "");
  const ramoFinal = t.lastIndexOf(`echo "Can't find lefthook in PATH"`);
  return {
    resolvePelaPrincipal: t.includes("--path-format=relative --git-common-dir"),
    falhaFechado:
      ramoFinal !== -1 && /(^|\n)\s*exit 1\s*(\n|$)/.test(t.slice(ramoFinal)),
  };
}

const descreverPerfil = (p) =>
  p === null
    ? "ausente"
    : `resolve-pela-principal=${p.resolvePelaPrincipal ? "sim" : "NÃO"}, ` +
      `falha-fechado=${p.falhaFechado ? "sim" : "NÃO"}`;

/**
 * O estado de UM hook: o que está instalado bate com o que esta config gera?
 *
 * Fecha em booleano ESTRITO de propósito (`=== true`, nunca só veracidade).
 * Este é o predicado que decide "a trava está de pé" — se ele puder valer
 * `undefined`, o verificador deixa de falhar fechado, que é o defeito que este
 * script inteiro existe para pegar.
 *
 * Só `"em-dia"` é sucesso. Todo o resto reprova o controle.
 */
function estadoDoHook(perfilInstalado, perfilReferencia) {
  if (perfilReferencia === null) return "sem-referencia";
  if (perfilInstalado === null) return "ausente";

  const referenciaFecha =
    perfilReferencia.resolvePelaPrincipal === true &&
    perfilReferencia.falhaFechado === true;
  if (!referenciaFecha) return "config-nao-fecha";

  const instaladoFecha =
    perfilInstalado?.resolvePelaPrincipal === true &&
    perfilInstalado?.falhaFechado === true;
  const batem =
    perfilInstalado.resolvePelaPrincipal ===
      perfilReferencia.resolvePelaPrincipal &&
    perfilInstalado.falhaFechado === perfilReferencia.falhaFechado;

  return batem && instaladoFecha ? "em-dia" : "divergente";
}

// Verdadeiro quando o próprio `lefthook.yml` perdeu as chaves. Guardado no
// escopo do módulo porque o veredito final, lá embaixo, precisa escolher o
// mesmo remédio que o controle 0 escolheu lá em cima.
let configNaoFecha = false;

const CONSERTO_DA_CONFIG =
  "  CONSERTO: o problema NÃO está no `.git/hooks` — está no próprio\n" +
  "  `lefthook.yml` desta árvore, que perdeu `assert_lefthook_installed` ou a\n" +
  "  chave `lefthook:`. Reinstalar o hook a partir dele só gravaria a versão\n" +
  "  errada com mais convicção.\n" +
  "\n" +
  "  Recupere as duas chaves no `lefthook.yml` (o `npm run test:unit` diz\n" +
  "  exatamente qual sumiu) e SÓ ENTÃO rode `npx --no-install lefthook install`.";

const CONSERTO_DO_HOOK =
  "  CONSERTO: rode `npx --no-install lefthook install` NESTA árvore — isso\n" +
  "  regrava o `.git/hooks/*` a partir deste `lefthook.yml`. Se ele reclamar\n" +
  "  que não achou o lefthook, rode `npm install` e repita.\n" +
  "\n" +
  "  O `--no-install` NÃO é enfeite: sem ele, no dia em que o `node_modules`\n" +
  "  estiver quebrado o npx BAIXA `lefthook@latest` do registro e é ESSA\n" +
  "  versão que reescreve o `.git/hooks` de todas as cópias paralelas. Numa\n" +
  "  ferramenta de segurança, trocar a versão travada no `package-lock.json`\n" +
  "  por qualquer coisa que o registro sirva naquele minuto é o oposto do que\n" +
  "  se quer. Com `--no-install` o comando falha em vez de improvisar.\n" +
  "\n" +
  "  E conte com isto voltando a acontecer: o `.git/hooks` é COMPARTILHADO\n" +
  "  por todas as cópias paralelas (worktrees) do repositório, e o lefthook o\n" +
  "  reescreve sozinho sempre que o `lefthook.yml` da árvore de onde se\n" +
  "  commitou tem checksum diferente do último sincronizado. Enquanto houver\n" +
  "  worktree em branch SEM estas chaves, qualquer commit ou push feito de lá\n" +
  "  reverte o hook de todo mundo para a versão que aprova em silêncio.\n" +
  "  Isso só acaba quando as chaves chegarem à branch base e cada árvore\n" +
  "  puxar (`git pull`).";

const SEM_AS_CHAVES = (yml) =>
  yml
    .split(/\r?\n/)
    .filter(
      (l) =>
        !l.startsWith("assert_lefthook_installed:") &&
        !l.startsWith("lefthook:"),
    )
    .join("\n");

const SEM_PATH_FORMAT = (yml) => yml.replace("--path-format=relative ", "");

// --------------------------------------------------------------------------
// Controles
// --------------------------------------------------------------------------

/** @type {{nome: string, estado: "PASSOU"|"FALHOU"|"INDETERMINADO", detalhe: string}[]} */
const resultados = [];
const CONTROLES_ESPERADOS = 6;

function registrar(nome, estado, detalhe) {
  resultados.push({ nome, estado, detalhe });
  const marca =
    estado === "PASSOU" ? "OK  " : estado === "FALHOU" ? "FALHA" : "?????";
  console.log(`  [${marca}] ${nome}\n         ${detalhe}`);
}

/**
 * Classifica um controle a partir do que foi observado. Todo caso fora dos
 * previstos cai em INDETERMINADO — que conta como reprovação no veredito.
 * Nenhum acumulador nasce verdadeiro aqui: o sucesso é afirmado, nunca herdado.
 */
function classificar(nome, { esperado, observado, detalhe }) {
  if (esperado === observado) registrar(nome, "PASSOU", detalhe);
  else if (observado === "inesperado")
    registrar(nome, "INDETERMINADO", detalhe);
  else registrar(nome, "FALHOU", detalhe);
}

let SH = null;
let abortada = false;

try {
  // ----------------------------------------------------------------------
  secao("Arranjo. O caminho temporário é ignorado pelo git da árvore real?");
  const ignorado = git(["check-ignore", "-q", RELATIVO_TEMP], RAIZ);
  if (ignorado.code !== 0) {
    throw new ProvaAbortada(
      `ABORTADO: \`${RELATIVO_TEMP}\` NÃO é ignorado pelo git desta árvore.
Criar o repositório de prova ali deixaria arquivo novo visível no
\`git status\` de outras sessões, e ninguém saberia de onde veio.
Conserto: garanta que \`scratch/\` continua no .gitignore.`,
    );
  }
  console.log(`  ${RELATIVO_TEMP} -> ignorado (.gitignore). Pode criar.`);

  if (!existsSync(LEFTHOOK_REAL)) {
    throw new ProvaAbortada(
      `ABORTADO: não achei o lefthook em ${LEFTHOOK_REAL}
Rode \`npm install\` na árvore principal do projeto.`,
    );
  }

  SH = acharSh();
  if (!SH) {
    throw new ProvaAbortada(
      "ABORTADO: não achei um `sh` para executar o shim do hook.\n" +
        "Os controles 3, 4 e 5 rodam o `.git/hooks/pre-commit` diretamente.",
    );
  }

  mkdirSync(TEMP, { recursive: true });

  // ----------------------------------------------------------------------
  secao("0. Os hooks que o git VAI EXECUTAR aqui são o que esta config gera?");
  console.log(
    "  Os controles 1 a 5 medem a CONFIGURAÇÃO, num repositório descartável.\n" +
      "  Este mede os três `.git/hooks/*` que o git chama NESTA árvore — que\n" +
      "  são compartilhados com as outras cópias paralelas e podem estar velhos.\n" +
      "  O `pre-push` entra porque é ele que carrega o `guarda-de-branch`, a\n" +
      "  única barreira contra push direto em main/develop neste plano.\n",
  );

  // Os hooks EM USO são lidos ANTES de a referência ser gerada, de propósito:
  // o `.git/hooks` é compartilhado, outra cópia paralela pode reescrevê-lo a
  // qualquer instante, e quanto menor a janela entre ler e concluir, menos
  // chance de o veredito falar de um arquivo que já mudou. Medido em
  // 20/08/2026: gerar a referência NÃO toca no `.git/hooks` real (md5 igual
  // antes e depois de uma rodada inteira) — a ordem aqui é margem, não conserto.
  const instalados = HOOKS.map((nome) => {
    const caminho = caminhoDoHookEmUso(nome);
    const texto =
      caminho !== null && existsSync(caminho)
        ? readFileSync(caminho, "utf8")
        : null;
    return { nome, caminho, texto };
  });

  const referencias = shimsDeReferencia();

  const estadosDosHooks = instalados.map(({ nome, caminho, texto }) => {
    const instalado = texto === null ? null : perfilDoShim(texto);
    const textoReferencia = referencias.get(nome) ?? null;
    const referencia =
      textoReferencia === null ? null : perfilDoShim(textoReferencia);
    return {
      nome,
      caminho,
      instalado,
      referencia,
      estado: estadoDoHook(instalado, referencia),
    };
  });

  for (const h of estadosDosHooks) {
    console.log(`  ${h.nome}`);
    console.log(`    em uso:     ${h.caminho ?? "(não resolvido)"}`);
    console.log(`    instalado:  ${descreverPerfil(h.instalado)}`);
    console.log(
      `    referência: ${descreverPerfil(h.referencia)}  (config atual)`,
    );
    console.log(`    estado:     ${h.estado}`);
  }

  const foraDeDia = estadosDosHooks.filter((h) => h.estado !== "em-dia");
  const observadoHook =
    foraDeDia.length === 0
      ? "em-dia"
      : foraDeDia.some((h) => h.estado === "sem-referencia")
        ? "inesperado"
        : "fora-de-dia";

  classificar("0. EM USO — os 3 hooks instalados batem com a config ATUAL", {
    esperado: "em-dia",
    observado: observadoHook,
    detalhe:
      foraDeDia.length === 0
        ? `${HOOKS.join(", ")}: cada um tem as duas propriedades que a config gera`
        : `fora de dia -> ${foraDeDia.map((h) => `${h.nome} (${h.estado})`).join(", ")}`,
  });

  // O remédio depende do que quebrou, e o estado por hook é mais fino que o
  // `observadoHook` (que só resume em em-dia/inesperado/fora-de-dia).
  // `config-nao-fecha` significa que o PRÓPRIO `lefthook.yml` perdeu as chaves
  // — reinstalar o hook a partir dele só grava a versão errada com mais
  // convicção. Mandar `lefthook install` aqui seria dar o conserto do problema
  // vizinho, que é como um verificador honesto vira um verificador que atrapalha.
  configNaoFecha = foraDeDia.some((h) => h.estado === "config-nao-fecha");
  if (configNaoFecha) {
    console.log("");
    console.log(CONSERTO_DA_CONFIG);
  } else if (observadoHook !== "em-dia") {
    console.log("");
    console.log(CONSERTO_DO_HOOK);
  }

  // ----------------------------------------------------------------------
  secao("1 e 2. Commit de verdade, de dentro de um worktree (config ATUAL)");

  const atual = montarRepo("atual", (yml) => yml);

  // Premissa do arranjo: o caminho absoluto do worktree tem espaço, como o do
  // projeto. Sem isso os controles rodariam num terreno mais fácil que o real.
  const temEspaco = atual.wt.includes(" ");
  console.log(`  worktree: ${atual.wt}`);
  console.log(`  caminho com espaço: ${temEspaco ? "sim" : "NÃO"}`);
  if (!temEspaco) {
    throw new ProvaAbortada(
      "ABORTADO: o caminho do worktree de prova não tem espaço, então ele\n" +
        "não reproduz o terreno real e o controle 5 não provaria nada.",
    );
  }

  const arquivo = join(atual.wt, "credencial-de-teste.txt");

  // --- 1. POSITIVO --------------------------------------------------------
  writeFileSync(arquivo, `${segredoFalso()}\n`);
  gitExige(["add", "credencial-de-teste.txt"], atual.wt);
  const staged = gitExige(
    ["diff", "--cached", "--name-only"],
    atual.wt,
  ).saida.trim();
  if (staged !== "credencial-de-teste.txt") {
    throw new Error(`arranjo furado: staged = "${staged}"`);
  }
  const comSegredo = git(["commit", "-m", "test: segredo falso"], atual.wt);
  const nomeouSecretlint = /secretlint/i.test(comSegredo.saida);
  classificar("1. POSITIVO — commit com segredo falso é RECUSADO", {
    esperado: "recusado",
    observado:
      comSegredo.code !== 0 && nomeouSecretlint
        ? "recusado"
        : comSegredo.code === 0
          ? "aprovado"
          : "inesperado",
    detalhe:
      `exit=${comSegredo.code}, a saída nomeia o secretlint: ` +
      `${nomeouSecretlint ? "sim" : "NÃO"}`,
  });
  console.log(indentar(comSegredo.saida));

  // --- 2. NEGATIVO --------------------------------------------------------
  writeFileSync(arquivo, `${LINHA_LIMPA}\n`);
  gitExige(["add", "credencial-de-teste.txt"], atual.wt);
  const semSegredo = git(
    ["commit", "-m", "test: mesmo arquivo, sem segredo"],
    atual.wt,
  );
  // Exigir o nome do secretlint aqui também não é preciosismo: um hook que não
  // roda NADA aprova o arquivo limpo com exit 0 e satisfaria este controle
  // sozinho. "Passou" só vale se a trava tiver de fato olhado o arquivo.
  const nomeouSecretlintLimpo = /secretlint/i.test(semSegredo.saida);
  const registrou =
    semSegredo.code === 0 &&
    git(["log", "--oneline", "-1"], atual.wt).saida.includes("sem segredo");
  const commitou = registrou && nomeouSecretlintLimpo;
  classificar("2. NEGATIVO — o MESMO arquivo, limpo, PASSA pela trava LIGADA", {
    esperado: "aprovado",
    observado: commitou
      ? "aprovado"
      : semSegredo.code === 0
        ? "inesperado"
        : "recusado",
    detalhe:
      `exit=${semSegredo.code}, commit registrado: ${registrou ? "sim" : "NÃO"}, ` +
      `a saída nomeia o secretlint: ${nomeouSecretlintLimpo ? "sim" : "NÃO"}`,
  });
  console.log(indentar(semSegredo.saida));

  // ----------------------------------------------------------------------
  secao("3 e 4. Lefthook fora de alcance — o cenário que motivou tudo");
  console.log(
    "  O shim é rodado com o PATH vazio: nenhum dos ramos de fallback acha\n" +
      "  binário nenhum, e a execução chega ao `else` final. É o mesmo estado\n" +
      "  de um worktree sem `node_modules`, só que forçado e determinístico.\n",
  );

  const antes = montarRepo("antes", SEM_AS_CHAVES);
  const semPath = { PATH: "", SystemRoot: process.env.SystemRoot ?? "" };

  const rAntes = roda(SH, [antes.hook], { cwd: antes.repo, env: semPath });
  const chegouNoElse = rAntes.saida.includes("Can't find lefthook in PATH");
  classificar("3. ANTES — sem as duas chaves, o git APROVAVA (exit 0)", {
    esperado: "aprovava",
    observado:
      rAntes.code === 0 && chegouNoElse
        ? "aprovava"
        : rAntes.code !== 0 && chegouNoElse
          ? "recusava"
          : "inesperado",
    detalhe:
      `exit=${rAntes.code}, chegou ao ramo final do shim: ` +
      `${chegouNoElse ? "sim" : "NÃO"}`,
  });
  console.log(indentar(rAntes.saida));

  const rAtual = roda(SH, [atual.hook], { cwd: atual.wt, env: semPath });
  classificar("4. DEPOIS — com a chave `lefthook:`, o git RECUSA (exit != 0)", {
    esperado: "recusa",
    observado: rAtual.code !== 0 ? "recusa" : "aprova",
    detalhe: `exit=${rAtual.code}`,
  });
  console.log(
    "\n  ATRIBUIÇÃO DE CAUSA, medida em 20/08/2026 — não confunda as duas chaves:\n" +
      "  o lefthook emite a chave `lefthook:` como\n" +
      '  `elif test -n "<valor>/../node_modules/.bin/lefthook"`, e essa string\n' +
      "  tem sufixo LITERAL: `test -n` nela é SEMPRE verdadeiro. Ou seja, o ramo\n" +
      "  2 do shim é incondicional, e TUDO abaixo dele virou código morto —\n" +
      "  inclusive o `else` final onde `assert_lefthook_installed: true` põe o\n" +
      "  `exit 1`. O `exit != 0` acima é o ramo 2 não achando o binário\n" +
      "  (exit 127), NÃO o `assert_`. Com a chave `lefthook:` presente, o\n" +
      "  `assert_lefthook_installed` não muda nenhum comportamento observável;\n" +
      "  ele é a reserva que volta a valer se a `lefthook:` sumir.",
  );
  console.log(indentar(rAtual.saida));

  // ----------------------------------------------------------------------
  secao("5. O espaço no caminho — por que `--path-format=relative` está lá");
  console.log(
    "  O lefthook emite o valor da chave `lefthook:` SEM aspas no shim\n" +
      '  (`then <valor> "$@"`). Sem `--path-format=relative` o git devolve o\n' +
      "  caminho ABSOLUTO, que aqui tem espaço, e o shell quebra em palavras.\n" +
      "  O controle 2 acima é o par deste: com a flag, o mesmo cenário passa.\n",
  );

  const absoluto = montarRepo("absoluto", SEM_PATH_FORMAT);
  const rEspaco = roda(SH, [absoluto.hook], { cwd: absoluto.wt });
  classificar("5. ESPAÇO — sem a flag, o shim quebra de dentro do worktree", {
    esperado: "quebra",
    observado: rEspaco.code !== 0 ? "quebra" : "funciona",
    detalhe: `exit=${rEspaco.code}`,
  });
  console.log(indentar(rEspaco.saida));
} catch (erro) {
  // Erro de verdade continua subindo com a pilha inteira; só o aborto
  // controlado é tratado aqui — e nos dois casos o `finally` roda.
  if (!(erro instanceof ProvaAbortada)) throw erro;
  console.error(`\n${erro.message}`);
  abortada = true;
} finally {
  if (existsSync(TEMP)) {
    try {
      rmSync(TEMP, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
      console.log(`\nLimpeza: ${RELATIVO_TEMP} removido.`);
    } catch (e) {
      console.error(
        `\nATENÇÃO: não consegui remover ${TEMP}
${e.message}
Remova à mão (PowerShell):
  Remove-Item -Recurse -Force "${TEMP}"`,
      );
    }
  }
}

// --------------------------------------------------------------------------
// Veredito — só é sucesso com prova positiva de TODOS os controles
// --------------------------------------------------------------------------

secao("VEREDITO");

if (abortada) {
  console.log(
    "  PROVA ABORTADA antes de terminar. Nada foi medido — e isto NÃO é o\n" +
      "  mesmo que a trava estar de pé. NÃO trate o hook como proteção.",
  );
  process.exit(2);
}

const passaram = resultados.filter((r) => r.estado === "PASSOU").length;
console.log(
  `  controles executados: ${resultados.length} de ${CONTROLES_ESPERADOS}`,
);
for (const r of resultados) console.log(`  ${r.estado.padEnd(14)} ${r.nome}`);

const controleEmUso = resultados.find((r) => r.nome.startsWith("0."));
const hookEmUsoOk =
  controleEmUso !== undefined && controleEmUso.estado === "PASSOU";
const aprovado =
  resultados.length === CONTROLES_ESPERADOS &&
  passaram === CONTROLES_ESPERADOS &&
  hookEmUsoOk;

console.log("");
if (aprovado) {
  console.log(
    "  TRAVA LIGADA E FECHADA. Os três hooks que o git executa NESTA árvore\n" +
      "  (pre-commit, commit-msg e pre-push) são o que esta configuração gera;\n" +
      "  commit com senha de banco é recusado de dentro de um worktree; arquivo\n" +
      "  limpo passa pelo secretlint; e o shim sai com erro — não com sucesso —\n" +
      "  quando não acha o lefthook.",
  );
  process.exit(0);
}
if (!hookEmUsoOk) {
  console.log(
    "  TRAVA DESLIGADA NESTA ÁRVORE. A configuração pode até estar certa, mas\n" +
      "  pelo menos um dos `.git/hooks/*` que o git realmente chama aqui NÃO é\n" +
      "  o que ela gera — e são eles que decidem se o seu commit e o seu push\n" +
      "  passam. Veja acima qual divergiu.\n",
  );
  console.log(configNaoFecha ? CONSERTO_DA_CONFIG : CONSERTO_DO_HOOK);
  console.log("");
}
console.log(
  "  TRAVA NÃO PROVADA. Algum controle não deu o resultado esperado (ou nem\n" +
    "  chegou a rodar). NÃO trate o hook como proteção até isto fechar.",
);
process.exit(1);

function indentar(texto) {
  return String(texto ?? "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .map((l) => `         | ${l}`)
    .join("\n");
}
