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
 *   1. POSITIVO   senha de banco staged -> commit RECUSADO e o secretlint é
 *                                          nomeado na saída
 *  1b. POSITIVO   JWT `service_role` staged -> commit RECUSADO. Não é o
 *                 (JWT)      controle 1 de novo: são FORMATOS diferentes,
 *                            pegos por REGRAS diferentes. A senha cai no
 *                            preset-recommend; o JWT só cai na regra de
 *                            padrão, acrescentada ao `.secretlintrc.json` em
 *                            20/08/2026 justamente porque o preset é cego
 *                            para ele.
 *  1c. POSITIVO   chave `sb_secret_` staged -> commit RECUSADO. Mesma REGRA
 *                 (sb_secret_) que pega o JWT (1b) — a de padrão —, mas outro
 *                            padrão dentro dela: `sb_secret_...` é o formato
 *                            NOVO da chave secreta do Supabase, sucessor do
 *                            `service_role`, também ignora RLS, e o preset
 *                            recomendado é cego para ele igual era para o JWT.
 *  1d. POSITIVO   a MESMA chave `sb_secret_` de 1c, mas dentro de um `.ps1`
 *                 (PS1)      -> commit RECUSADO. Até 21/08/2026 o
 *                            `.secretlintignore` tinha `*.ps1` e `*.bat` na
 *                            lista de exceções: a regra de padrão (1c prova
 *                            que ela está certa) nunca chegava a rodar contra
 *                            um arquivo com essa extensão. O terminal deste
 *                            projeto é PowerShell, e há 4 arquivos `.ps1` e
 *                            `.bat` versionados aqui — era nessa casca que
 *                            a trava ficava cega.
 *   2. NEGATIVO   o MESMO arquivo limpo -> commit PASSA, e o secretlint
 *                                          continua sendo nomeado (senão um
 *                                          hook que não roda nada "aprova")
 *      (1, 1b, 1c, 1d e 2 rodam de dentro de um `git worktree`, que é onde a
 *      trava estava desligada; o caminho absoluto deles tem espaços, como o
 *      do projeto.)
 *   3. ANTES      shim gerado da MESMA config, só sem as duas chaves de topo,
 *                 com o lefthook fora de alcance -> exit 0  (o bug histórico)
 *   4. DEPOIS     shim gerado da config ATUAL, mesmo cenário -> exit != 0
 *   5. ESPAÇO     shim com `--git-common-dir` mas SEM `--path-format=relative`,
 *                 rodado de um worktree -> quebra, porque o lefthook emite o
 *                 valor sem aspas e o caminho absoluto tem espaço
 *
 * POR QUE `1b` E NÃO UMA RENUMERAÇÃO: o `lefthook.yml` aponta para "controles
 * 3 e 4" pelo NÚMERO, ao explicar a atribuição de causa das duas chaves de
 * topo. Empurrar ANTES/DEPOIS para 4 e 5 deixaria aquele comentário apontando
 * para a coisa errada — num arquivo cujo assunto é justamente essa trava. O
 * controle novo entra ao lado do irmão dele e os ponteiros existentes ficam
 * de pé. Quem acrescentar o próximo: mesma regra, ou conserte os ponteiros.
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
import { randomBytes } from "node:crypto";
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
 * O PATH sem `node_modules` é o que dá validade aos controles 1, 1b e 2.
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
// Os segredos falsos. Gerados aqui, nunca lidos de arquivo: um script de prova
// que carrega credencial de verdade é o próprio incidente que ele deveria
// pegar. Também não existem como literal no fonte — o que está escrito é a
// receita, não a isca.
//
// São TRÊS formatos, e caem em DUAS regras — uma pode ceder sem a outra:
//
//   senha de banco  URL de conexão PostgreSQL com senha, que é exatamente o
//                   que já foi commitado neste repositório. Pega pelo
//                   @secretlint/secretlint-rule-database-connection-string,
//                   que vem no preset-recommend.
//   JWT             chave `service_role`/`anon` do Supabase, formato LEGADO
//                   (`eyJ...`). Medido em 20/08/2026: o preset-recommend
//                   (secretlint 13.0.4) é CEGO para este formato — a isca
//                   saía com 0 achados e o commit passava.
//   sb_secret_      chave secreta do Supabase, formato NOVO. Medido em
//                   21/08/2026: também cega para o preset-recommend, e a doc
//                   oficial do Supabase diz que o formato legado (linha
//                   acima) será descontinuado até o fim de 2026 — o dia em
//                   que o formato novo virar o único em uso é o dia em que
//                   este controle passa a ser o único que ainda pega a chave
//                   secreta.
//
//   JWT e `sb_secret_` são ambos pegos pelo @secretlint/secretlint-rule-pattern,
//   acrescentado ao `.secretlintrc.json` — como DOIS padrões dentro da MESMA
//   regra. `service_role`/`sb_secret_` são as credenciais mais perigosas
//   deste projeto, porque ignoram RLS. Se a regra de padrão sumir da config,
//   OS DOIS controles (1b e 1c) acendem juntos; se só um dos dois padrões
//   sumir de dentro dela, só o controle correspondente acende — é por isso
//   que os dois existem separados, e não um só cobrindo "a regra de padrão".
//
// Nenhuma das três é canônica de documentação: isca de exemplo costuma estar
// em allowlist do próprio detector, e aí "não pegou" vira indistinguível de
// furo real.
// --------------------------------------------------------------------------

function segredoFalso() {
  const senha = `senhaFalsaDeTeste${Date.now().toString(36)}`;
  return `DATABASE_URL=postgresql://postgres:${senha}@db.exemplo-que-nao-existe.supabase.co:5432/postgres`;
}

/**
 * Um JWT sintético bem formado, no molde que o Supabase emite.
 *
 * Bem formado NÃO é detalhe: um `ghp_` com 34 caracteres em vez de 36 sai
 * limpo do secretlint, e um controle positivo montado com isca torta prova o
 * contrário do que parece provar. Os três segmentos aqui são base64url de
 * verdade, e a assinatura vem do gerador criptográfico — nunca de um literal.
 */
function jwtFalso() {
  const b64url = (o) =>
    Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  const cabecalho = b64url({ alg: "HS256", typ: "JWT" });
  const corpo = b64url({
    iss: "supabase",
    ref: "projetoquenaoexiste",
    role: "service_role",
    iat: 1700000000,
    exp: 2000000000,
  });
  const assinatura = randomBytes(32).toString("base64url");
  return `SUPABASE_SERVICE_ROLE_KEY=${cabecalho}.${corpo}.${assinatura}`;
}

/**
 * Uma chave `sb_secret_` sintética, com formato realista.
 *
 * `{16,}` no `.secretlintrc.json` é o que separa chave de placeholder de
 * documentação (`sb_secret_...`, `sb_secret_xxx`) — por isso o sufixo aqui
 * tem bem mais que 16 caracteres, do mesmo alfabeto `[A-Za-z0-9_-]` que o
 * padrão aceita. A doc oficial do Supabase não publica o alfabeto nem o
 * comprimento reais dessas chaves; isto é a isca, não a especificação.
 */
function sbSecretFalso() {
  const alfabeto =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  const sufixo = Array.from(
    randomBytes(40),
    (b) => alfabeto[b % alfabeto.length],
  ).join("");
  return `SUPABASE_SECRET_KEY=sb_secret_${sufixo}`;
}

/**
 * A mesma chave `sb_secret_` sintética de `sbSecretFalso`, só que formatada
 * como um script PowerShell atribuiria a variável de ambiente — a forma que
 * um script de setup em PowerShell escreveria. O padrão
 * que o secretlint casa é o mesmo (o regex não olha para `$env:`/aspas); o
 * que muda é a CASCA — e é a casca (a extensão `.ps1`) que o buraco do
 * `.secretlintignore` explorava até 21/08/2026.
 */
function sbSecretComoScriptPs1() {
  const [, chave] = sbSecretFalso().split("=");
  return `$env:SUPABASE_SECRET_KEY = "${chave}"`;
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
const CONTROLES_ESPERADOS = 9;

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
  secao(
    "1, 1b e 2. Commit de verdade, de dentro de um worktree (config ATUAL)",
  );

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

  /**
   * Grava a isca no arquivo `nomeRelativo` (relativo ao worktree), confere
   * que ela chegou ao índice e tenta commitar.
   *
   * O `staged` é assertado de propósito: um `git add` que não pegou nada faria
   * o commit passar por motivo nenhum, e o controle leria isso como "a trava
   * aprovou". Arranjo é premissa, e premissa se mede antes do veredito.
   *
   * Generalizado para aceitar o nome do arquivo (e não só o conteúdo) porque
   * o controle 1d precisa de uma EXTENSÃO diferente (`.ps1`) — é a extensão,
   * não o conteúdo, que o buraco do `.secretlintignore` explorava.
   *
   * `git reset` ANTES do `add`: cada chamada tem de partir de um índice
   * LIMPO. Quando a trava recusa um commit (o caso comum aqui), o arquivo
   * fica staged e não sai do índice sozinho — e como os controles 1, 1b e 1c
   * reusam o MESMO nome (`credencial-de-teste.txt`), a reentrada não somava
   * (era o mesmo caminho se sobrescrevendo). O controle 1d usa outro nome
   * (`script-de-teste.ps1`) e por isso o índice passava a ter DUAS entradas,
   * disparando o `throw` abaixo por um motivo que não tinha nada a ver com o
   * que o controle mede. `git reset` (sem argumento, sem `--hard`) só move o
   * ÍNDICE de volta para o HEAD deste repositório descartável — não toca no
   * working tree e não é o `reset` proibido na árvore compartilhada, que é
   * outra árvore. A asserção abaixo continua EXATA de propósito: um `add`
   * frouxo que "pegasse algo" faria o commit passar por motivo nenhum.
   */
  const commitarArquivo = (nomeRelativo, conteudo, mensagem) => {
    gitExige(["reset"], atual.wt);
    writeFileSync(join(atual.wt, nomeRelativo), `${conteudo}\n`);
    gitExige(["add", nomeRelativo], atual.wt);
    const staged = gitExige(
      ["diff", "--cached", "--name-only"],
      atual.wt,
    ).saida.trim();
    if (staged !== nomeRelativo) {
      throw new Error(`arranjo furado: staged = "${staged}"`);
    }
    const r = git(["commit", "-m", mensagem], atual.wt);
    return { ...r, nomeouSecretlint: /secretlint/i.test(r.saida) };
  };

  const tentarCommit = (conteudo, mensagem) =>
    commitarArquivo("credencial-de-teste.txt", conteudo, mensagem);

  /** Recusado só conta quando o secretlint aparece na saída como o motivo. */
  const observadoNaRecusa = (r) =>
    r.code !== 0 && r.nomeouSecretlint
      ? "recusado"
      : r.code === 0
        ? "aprovado"
        : "inesperado";

  const detalheDaRecusa = (r) =>
    `exit=${r.code}, a saída nomeia o secretlint: ` +
    `${r.nomeouSecretlint ? "sim" : "NÃO"}`;

  // --- 1. POSITIVO: senha de banco (preset-recommend) ---------------------
  const comSenha = tentarCommit(segredoFalso(), "test: senha de banco falsa");
  classificar("1. POSITIVO — commit com senha de banco é RECUSADO", {
    esperado: "recusado",
    observado: observadoNaRecusa(comSenha),
    detalhe: detalheDaRecusa(comSenha),
  });
  console.log(indentar(comSenha.saida));

  // --- 1b. POSITIVO: JWT do Supabase (regra de padrão) ---------------------
  // Este controle é a razão de o `.secretlintrc.json` ter mais do que o
  // preset. Até 20/08/2026 esta mesma isca era commitada sem um pio: o
  // preset-recommend não tem regra de JWT, e `service_role` ignora RLS. Se
  // alguém tirar a regra de padrão da config, é AQUI que aparece.
  const comJwt = tentarCommit(jwtFalso(), "test: jwt service_role falso");
  classificar("1b. POSITIVO — commit com JWT `service_role` é RECUSADO", {
    esperado: "recusado",
    observado: observadoNaRecusa(comJwt),
    detalhe: detalheDaRecusa(comJwt),
  });
  console.log(indentar(comJwt.saida));

  // --- 1c. POSITIVO: sb_secret_ do Supabase (regra de padrão) -------------
  // Segundo padrão dentro da MESMA regra de padrão que o 1b. A doc oficial do
  // Supabase diz que o formato JWT (legado) será descontinuado até o fim de
  // 2026 em favor deste — se alguém tirar SÓ este padrão da config (e deixar
  // o JWT), o 1b continua verde e é este controle que acende sozinho.
  const comSbSecret = tentarCommit(sbSecretFalso(), "test: sb_secret_ falso");
  classificar("1c. POSITIVO — commit com chave `sb_secret_` é RECUSADO", {
    esperado: "recusado",
    observado: observadoNaRecusa(comSbSecret),
    detalhe: detalheDaRecusa(comSbSecret),
  });
  console.log(indentar(comSbSecret.saida));

  // --- 1d. POSITIVO: sb_secret_ dentro de um `.ps1` -----------------------
  // SEGUNDO buraco na mesma trava, fechado em 21/08/2026: até então o
  // `.secretlintignore` tinha `*.ps1` (e `*.bat`) na lista de exceções — a
  // MESMA credencial do controle 1c, só que dentro de um script PowerShell,
  // nunca chegava a ser varrida pela regra de padrão (que o 1c já prova
  // certa). O terminal deste projeto é PowerShell e há 4 arquivos `.ps1` e
  // `.bat` versionados aqui — era nessa casca que a trava ficava cega.
  // Se alguém puser `*.ps1` de volta no
  // `.secretlintignore`, é este controle que acende sozinho.
  const comSbSecretPs1 = commitarArquivo(
    "script-de-teste.ps1",
    sbSecretComoScriptPs1(),
    "test: sb_secret_ falso dentro de .ps1",
  );
  classificar(
    "1d. POSITIVO — commit com `sb_secret_` dentro de um `.ps1` é RECUSADO",
    {
      esperado: "recusado",
      observado: observadoNaRecusa(comSbSecretPs1),
      detalhe: detalheDaRecusa(comSbSecretPs1),
    },
  );
  console.log(indentar(comSbSecretPs1.saida));

  // --- 2. NEGATIVO --------------------------------------------------------
  const semSegredo = tentarCommit(
    LINHA_LIMPA,
    "test: mesmo arquivo, sem segredo",
  );
  // Exigir o nome do secretlint aqui também não é preciosismo: um hook que não
  // roda NADA aprova o arquivo limpo com exit 0 e satisfaria este controle
  // sozinho. "Passou" só vale se a trava tiver de fato olhado o arquivo.
  const nomeouSecretlintLimpo = semSegredo.nomeouSecretlint;
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
      "  commit com senha de banco, com JWT `service_role`, com chave\n" +
      "  `sb_secret_` do Supabase (formato legado e formato novo, inclusive\n" +
      "  dentro de um `.ps1`) são recusados de dentro de um worktree; arquivo\n" +
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
