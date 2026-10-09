#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename --
 * Caminhos vêm do próprio git (rev-parse), de argumento da CLI do dev ou são
 * resolvidos contra a raiz do projeto — mesma convenção de scripts/db-apply.cjs.
 * Nunca há entrada de rede nem payload de terceiro. */
/**
 * CLI das frentes paralelas — worktree próprio + faixa de arquivos + integração.
 *
 * Contexto e decisões: docs/processo/ARQUITETURA-PARALELA.md. Em uma linha: o
 * orquestrador decompõe o pedido em FRENTES com donos de arquivo disjuntos
 * (manifesto JSON), cada frente roda no seu worktree, e só o integrador junta —
 * em ordem, depois de provar que cada frente ficou dentro da própria faixa.
 *
 * Uso (tudo deterministico, sem rede; git só por spawn com array de argumentos):
 *
 *   node scripts/paralelo/frente.mjs validar   <manifesto>
 *   node scripts/paralelo/frente.mjs criar     <manifesto> <frente> [--base <ref>]
 *   node scripts/paralelo/frente.mjs entrar    <manifesto> <frente>      (dentro do worktree)
 *   node scripts/paralelo/frente.mjs conferir  [--base <ref>]            (dentro do worktree)
 *   node scripts/paralelo/frente.mjs commitar  -m "<mensagem>"           (dentro do worktree)
 *   node scripts/paralelo/frente.mjs status    <manifesto> [frente=branch…]
 *   node scripts/paralelo/frente.mjs integrar  <manifesto> [frente=branch…] [--so-conferir] [--escopo <e>]
 *   node scripts/paralelo/frente.mjs limpar    <manifesto>
 *
 * O que ele NUNCA faz: push, `--no-verify`, reset/clean/stash/checkout, tocar
 * fora de .worktrees/ e do worktree em que foi chamado, mexer em arquivo da
 * árvore principal além do merge de `integrar`.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  conferirAlterados,
  maiorPrefixoDeMigration,
  riscoDoCaminho,
  riscoDoConteudo,
  validarManifesto,
} from "./faixas.mjs";
import {
  PASTA_DE_MANIFESTOS,
  origemValida,
  verificarFaixa,
} from "./integridade.mjs";

const LANE_FILE = join(".claude", "lane.json");

/* ───────────────────────── git e caminhos ───────────────────────── */

export function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    ok: r.status === 0,
    out: (r.stdout ?? "").trim(),
    err: (r.stderr ?? "").trim(),
    status: r.status,
  };
}

function falhar(msg, codigo = 1) {
  console.error(`✗ ${msg}`);
  process.exit(codigo);
}

/**
 * Lista de nomes de arquivo do git em modo `-z` (separador NUL, sem trim).
 * SEM `-z` o git escapa nome com acento/espaço/aspas como `"src/configura\303\247\303\243o.ts"`
 * (aspas e octais incluídos) — a conferência de faixa compararia o nome escapado e reprovaria
 * arquivo legítimo, e `git add -- <nome escapado>` falharia. Os nomes deste repo são em português.
 */
function nomesZ(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0)
    return { ok: false, err: (r.stderr ?? "").trim(), nomes: [] };
  return {
    ok: true,
    err: "",
    nomes: (r.stdout ?? "").split("\0").filter(Boolean),
  };
}

/** Raiz da árvore PRINCIPAL (a que dona o .git), a partir de qualquer worktree. */
export function raizPrincipal(cwd) {
  const r = git(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    cwd,
  );
  if (!r.ok) falhar(`não é um repositório git: ${cwd}`);
  return dirname(r.out);
}

export function raizDoWorktree(cwd) {
  const r = git(["rev-parse", "--show-toplevel"], cwd);
  if (!r.ok) falhar(`não é um repositório git: ${cwd}`);
  return resolve(r.out);
}

/** É um worktree LIGADO (não a árvore principal)? */
export function ehWorktreeLigado(cwd) {
  const gd = git(
    ["rev-parse", "--path-format=absolute", "--absolute-git-dir"],
    cwd,
  );
  const cd = git(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    cwd,
  );
  return gd.ok && cd.ok && resolve(gd.out) !== resolve(cd.out);
}

export function carregarManifesto(arg, cwd) {
  if (!arg) falhar("faltou o caminho do manifesto");
  // Primeiro o worktree ATUAL (o que está commitado nele), depois a principal: um arquivo velho
  // de mesmo nome na principal não pode vencer o manifesto do worktree em que se trabalha.
  const candidatos = isAbsolute(arg)
    ? [arg]
    : [
        join(raizDoWorktree(cwd), arg),
        join(raizPrincipal(cwd), arg),
        join(cwd, arg),
      ];
  const achado = candidatos.find((c) => existsSync(c));
  if (!achado) falhar(`manifesto não encontrado: ${arg}`);
  try {
    return {
      manifesto: JSON.parse(readFileSync(achado, "utf8")),
      caminho: achado,
    };
  } catch (e) {
    return falhar(`manifesto não é JSON válido (${achado}): ${e.message}`);
  }
}

function maiorMigrationDoRepo(cwd) {
  const dir = join(raizPrincipal(cwd), "supabase", "migrations");
  const nomes = existsSync(dir) ? readdirSync(dir) : [];
  // Branches remotas já buscadas também contam: outra sessão que publicou uma
  // migration à frente da sua cópia ocuparia a mesma numeração (medido: ~1 s
  // para ~400 branches). O que ainda não foi publicado de uma sessão local
  // ninguém enxerga daqui — a faixa tem que ser confirmada com o dono/mural.
  const refs = git(
    ["for-each-ref", "--format=%(refname)", "refs/remotes/origin"],
    cwd,
  )
    .out.split("\n")
    .filter(Boolean);
  for (const ref of refs) {
    const t = git(["ls-tree", "--name-only", ref, "supabase/migrations/"], cwd);
    if (t.ok) nomes.push(...t.out.split("\n").map((n) => n.split("/").pop()));
  }
  return maiorPrefixoDeMigration(nomes);
}

/**
 * `piso: false` pula a checagem "faixa de migration acima da maior existente".
 * Ela vale no PLANEJAMENTO (`validar`, `criar`); depois que a primeira frente é
 * integrada, as migrations dela passam a existir na árvore principal e a mesma
 * checagem reprovaria o retry de um `integrar` interrompido.
 */
function validarOuSair(manifesto, cwd, { piso = true } = {}) {
  const { erros, avisos } = validarManifesto(manifesto, {
    maiorMigrationExistente: piso ? maiorMigrationDoRepo(cwd) : null,
  });
  for (const a of avisos) console.warn(`! ${a}`);
  if (erros.length) {
    console.error("✗ manifesto reprovado:");
    for (const e of erros) console.error(`  - ${e}`);
    process.exit(1);
  }
}

function acharFrente(manifesto, nome) {
  const f = (manifesto.frentes ?? []).find((x) => x.nome === nome);
  if (!f)
    falhar(
      `frente "${nome}" não existe no manifesto (${(manifesto.frentes ?? []).map((x) => x.nome).join(", ")})`,
    );
  return f;
}

const nomeDaBranch = (manifesto, frente) =>
  `paralelo/${manifesto.plano}/${frente}`;

/**
 * `frente=branch` na linha de comando. Frente criada por `criar` usa o nome
 * padrão (`paralelo/<plano>/<frente>`); frente rodada pelo worktree NATIVO do
 * subagente (`isolation: worktree`) tem branch `worktree-agent-<id>` e precisa
 * ser informada aqui.
 */
function mapaDeBranches(args) {
  const mapa = new Map();
  for (const p of args) {
    const m = /^([a-z0-9-]+)=(.+)$/.exec(p);
    if (m) mapa.set(m[1], m[2]);
  }
  return mapa;
}
const pastaDoWorktree = (cwd, manifesto, frente) =>
  join(raizPrincipal(cwd), ".worktrees", `${manifesto.plano}-${frente}`);

/**
 * Artefatos que não são trabalho da frente: a própria faixa (`.claude/lane.json`) e o
 * `node_modules` (as ferramentas criam ali só cache — `.vite`, `.tmp/*.tsbuildinfo` —; ele é
 * um diretório REAL e próprio do worktree, nunca um link para a principal). Filtrar aqui vale
 * também para repo que não ignora `.claude/`.
 */
const ehArtefatoDaFrente = (c) =>
  c === "node_modules" ||
  c.startsWith("node_modules/") ||
  c === ".claude/lane.json";

/**
 * Arquivos do mapa de risco entre os alterados de `base` até `ref`, por DUAS leituras que a frente e
 * o planejador não controlam: o CAMINHO (migration, edge function, checkout…) e o CONTEÚDO do diff
 * (`fin_*`, SECURITY DEFINER, `export` alterado…). Devolve `[[arquivo, "motivo; motivo"]]`.
 */
function riscosDoDiff(base, ref, arquivos, cwd) {
  const achados = [];
  for (const arq of arquivos) {
    const motivos = [];
    const doCaminho = riscoDoCaminho(arq);
    if (doCaminho) motivos.push(doCaminho);
    const diff = spawnSync(
      "git",
      ["diff", "-U0", "--no-renames", base, ref, "--", arq],
      { cwd, encoding: "utf8" },
    );
    if (diff.status === 0) motivos.push(...riscoDoConteudo(arq, diff.stdout));
    if (motivos.length) achados.push([arq, [...new Set(motivos)].join("; ")]);
  }
  return achados;
}

/** Arquivos alterados vs `base`: commitados + modificados + novos (não ignorados). */
export function alteradosDesde(base, cwd) {
  const tracked = nomesZ(
    ["diff", "-z", "--name-only", "--no-renames", base],
    cwd,
  );
  const novos = nomesZ(
    ["ls-files", "-z", "--others", "--exclude-standard"],
    cwd,
  );
  if (!tracked.ok) falhar(`git diff falhou: ${tracked.err}`);
  const lista = [...tracked.nomes, ...novos.nomes].filter(
    (c) => !ehArtefatoDaFrente(c),
  );
  return [...new Set(lista)];
}

function lerLane(cwd) {
  const raiz = raizDoWorktree(cwd);
  const arq = join(raiz, LANE_FILE);
  if (!existsSync(arq)) {
    falhar(
      `este worktree não tem faixa registrada (${LANE_FILE}). Rode antes:\n  node scripts/paralelo/frente.mjs entrar <manifesto> <frente>`,
    );
  }
  let lane;
  try {
    lane = JSON.parse(readFileSync(arq, "utf8"));
  } catch (e) {
    falhar(
      `lane.json ilegível (${e.message}) — a faixa foi adulterada ou corrompida`,
    );
  }
  // A faixa só vale se o manifesto embutido for o COMMITADO em `base` (ver integridade.mjs).
  const motivo = verificarFaixa(raiz, lane);
  if (motivo) falhar(`faixa não confiável: ${motivo}`);
  return { raiz, lane };
}

function exigirWorktreeLigado(cwd, comando) {
  if (!ehWorktreeLigado(cwd)) {
    falhar(
      `"${comando}" só roda DENTRO do worktree de uma frente — este é a árvore principal. Isso protege a árvore compartilhada de edição por engano.`,
    );
  }
}

/* ───────────────────────── comandos ───────────────────────── */

function cmdValidar([arg]) {
  const cwd = process.cwd();
  const { manifesto, caminho } = carregarManifesto(arg, cwd);
  validarOuSair(manifesto, cwd);
  console.log(`✓ ${caminho}`);
  console.log(
    `  plano: ${manifesto.plano} · ${manifesto.frentes.length} frentes disjuntas`,
  );
  for (const f of manifesto.frentes) {
    const fm = f.faixa_migrations
      ? ` · migrations ${f.faixa_migrations.de}-${f.faixa_migrations.ate}`
      : "";
    console.log(`  - ${f.nome}: ${f.posse.length} glob(s)${fm}`);
  }
}

function cmdEntrar([arg, nome]) {
  const cwd = process.cwd();
  exigirWorktreeLigado(cwd, "entrar");
  const raiz = raizDoWorktree(cwd);
  if (!arg) falhar("faltou o caminho do manifesto");
  // Caminho do manifesto RELATIVO À RAIZ e só de docs/superpowers/lanes/: um manifesto forjado
  // (ex.: um .json que a frente escreveu na própria posse) não pode virar a faixa dela.
  const rel = (isAbsolute(arg) ? relative(raiz, arg) : arg)
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
  if (!origemValida(rel)) {
    falhar(
      `o manifesto de \`entrar\` tem que ser um .json de ${PASTA_DE_MANIFESTOS} (recebi "${arg}")`,
    );
  }
  // E tem que estar COMMITADO no HEAD deste worktree: a fonte é o blob do git, nunca o arquivo
  // do disco (que a frente poderia ter editado).
  const head = git(["rev-parse", "HEAD"], raiz);
  if (!head.ok) falhar(`git rev-parse HEAD falhou: ${head.err}`);
  const blob = git(["show", `HEAD:${rel}`], raiz);
  if (!blob.ok) {
    falhar(
      `o manifesto ${rel} não está commitado no HEAD deste worktree — o orquestrador precisa commitá-lo ANTES de despachar as frentes`,
    );
  }
  let manifesto;
  try {
    manifesto = JSON.parse(blob.out);
  } catch (e) {
    return falhar(`manifesto commitado não é JSON válido: ${e.message}`);
  }
  validarOuSair(manifesto, cwd, { piso: false });
  acharFrente(manifesto, nome);
  const arqLane = join(raiz, LANE_FILE);
  // Recusa se JÁ existe faixa — a mesma ou outra, legível ou não: a faixa de um worktree se
  // registra UMA vez (por `criar` ou pelo agente, ao nascer) e nunca se refaz nem se troca.
  if (existsSync(arqLane)) {
    falhar(
      "este worktree já tem uma faixa registrada — ela se registra uma vez só e não se refaz nem se troca",
    );
  }
  mkdirSync(join(raiz, ".claude"), { recursive: true });
  writeFileSync(
    arqLane,
    `${JSON.stringify({ plano: manifesto.plano, frente: nome, base: head.out, origem: rel, manifesto }, null, 2)}\n`,
  );
  // node_modules: SEM link. O Node (e tsc, vite, vitest, eslint, biome, `npm run`) resolve
  // `node_modules` SUBINDO diretórios, e o worktree mora dentro do repo (.worktrees/ ou
  // .claude/worktrees/) — então já enxerga o node_modules da principal. Um link (junction no
  // Windows) é perigoso: `git worktree remove --force` o atravessa e esvazia a árvore principal.
  const principal = raizPrincipal(raiz);
  const nm = existsSync(join(principal, "node_modules"))
    ? "node_modules: o da principal, resolvido pelo Node subindo diretórios (sem link)"
    : "node_modules: AUSENTE na árvore principal — rode `npm ci` lá antes de verificar";
  console.log(`✓ frente "${nome}" registrada em ${raiz}`);
  console.log(`  base: ${head.out.slice(0, 8)} · ${nm}`);
  console.log(
    "  só escreva dentro da posse; compartilhado vira PEDIDO ao integrador. NUNCA `npm install`/`npm ci` aqui.",
  );
}

function cmdCriar([arg, nome, ...resto]) {
  const cwd = process.cwd();
  const { manifesto } = carregarManifesto(arg, cwd);
  validarOuSair(manifesto, cwd);
  acharFrente(manifesto, nome);
  const i = resto.indexOf("--base");
  const base = i >= 0 ? resto[i + 1] : "HEAD";
  // `--base` vai para `git worktree add -b <branch> <pasta> <base>`: um valor que começa com `-`
  // (`--force`, `--detach`) seria lido como OPÇÃO do git. Tem que ser uma referência de commit.
  if (
    !base ||
    base.startsWith("-") ||
    !git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`], cwd).ok
  ) {
    falhar(`--base inválido: "${base}" não é uma referência de commit`);
  }
  const pasta = pastaDoWorktree(cwd, manifesto, nome);
  const branch = nomeDaBranch(manifesto, nome);
  if (existsSync(pasta))
    falhar(`já existe: ${pasta} (use outro nome ou \`limpar\`)`);
  if (
    git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], cwd).ok
  ) {
    falhar(
      `a branch ${branch} já existe — nome novo é mais seguro que reaproveitar trabalho antigo`,
    );
  }
  mkdirSync(dirname(pasta), { recursive: true });
  const r = git(["worktree", "add", "-b", branch, pasta, base], cwd);
  if (!r.ok) falhar(`git worktree add falhou: ${r.err}`);
  console.log(`✓ worktree criado: ${pasta}  (branch ${branch}, base ${base})`);
  const entrar = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), "entrar", arg, nome],
    { cwd: pasta, stdio: "inherit" },
  );
  if (entrar.status !== 0)
    falhar("o worktree foi criado, mas `entrar` falhou — veja acima");
}

function cmdConferir(args) {
  const cwd = process.cwd();
  exigirWorktreeLigado(cwd, "conferir");
  const { raiz, lane } = lerLane(cwd);
  const i = args.indexOf("--base");
  const base = i >= 0 ? args[i + 1] : lane.base;
  const frente = acharFrente(lane.manifesto, lane.frente);
  const alterados = alteradosDesde(base, raiz);
  const violacoes = conferirAlterados(frente, lane.manifesto, alterados);
  if (violacoes.length) {
    console.error(
      `✗ frente "${lane.frente}": ${violacoes.length} arquivo(s) fora da faixa:`,
    );
    for (const v of violacoes) console.error(`  - ${v.caminho}  (${v.motivo})`);
    process.exit(1);
  }
  console.log(
    `✓ frente "${lane.frente}": ${alterados.length} arquivo(s) alterado(s), todos dentro da faixa`,
  );
}

function cmdCommitar(args) {
  const cwd = process.cwd();
  exigirWorktreeLigado(cwd, "commitar");
  const { raiz, lane } = lerLane(cwd);
  const i = args.indexOf("-m");
  const mensagem = i >= 0 ? args[i + 1] : null;
  if (!mensagem) falhar('faltou -m "<mensagem>"');
  const frente = acharFrente(lane.manifesto, lane.frente);
  const alterados = alteradosDesde("HEAD", raiz);
  if (alterados.length === 0) {
    console.log("nada a commitar");
    return;
  }
  const violacoes = conferirAlterados(frente, lane.manifesto, alterados);
  if (violacoes.length) {
    console.error(
      `✗ nada foi commitado — ${violacoes.length} arquivo(s) fora da faixa de "${lane.frente}":`,
    );
    for (const v of violacoes) console.error(`  - ${v.caminho}  (${v.motivo})`);
    console.error(
      "  Desfaça essas edições (ou peça ao integrador) e rode de novo.",
    );
    process.exit(1);
  }
  // `git add` só nos que EXISTEM: depois de um `git rm` a deleção já está no índice e
  // `git add -- <caminho apagado>` morre com "pathspec did not match" — e a frente não pode
  // desfazer isso (reset/restore são proibidos). `git commit -- <caminhos>` grava a deleção.
  const existentes = alterados.filter((c) => {
    try {
      lstatSync(join(raiz, c));
      return true;
    } catch {
      return false;
    }
  });
  if (existentes.length > 0) {
    const add = git(["add", "--all", "--", ...existentes], raiz);
    if (!add.ok) falhar(`git add falhou: ${add.err}`);
  }
  // Hooks (secretlint, commitlint) rodam — sem --no-verify, nunca.
  const c = spawnSync("git", ["commit", "-m", mensagem, "--", ...alterados], {
    cwd: raiz,
    stdio: "inherit",
  });
  if (c.status !== 0)
    falhar(
      "git commit reprovado (veja a saída dos hooks acima)",
      c.status ?? 1,
    );
  console.log(
    `✓ commit na branch da frente "${lane.frente}" (${alterados.length} arquivo(s))`,
  );
}

function cmdStatus([arg, ...resto]) {
  const cwd = process.cwd();
  const { manifesto } = carregarManifesto(arg, cwd);
  validarOuSair(manifesto, cwd, { piso: false });
  const mapa = mapaDeBranches(resto);
  const linhas = [];
  for (const f of manifesto.frentes ?? []) {
    const branch = mapa.get(f.nome) ?? nomeDaBranch(manifesto, f.nome);
    const pasta = pastaDoWorktree(cwd, manifesto, f.nome);
    const existe = git(
      ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
      cwd,
    ).ok;
    if (!existe) {
      linhas.push(`${f.nome.padEnd(28)} (sem branch ${branch})`);
      continue;
    }
    const base = git(["merge-base", "HEAD", branch], cwd).out;
    const aMais = git(["rev-list", "--count", `${base}..${branch}`], cwd).out;
    const sujo = existsSync(pasta) ? alteradosDesde("HEAD", pasta).length : "-";
    const dif = nomesZ(
      ["diff", "-z", "--name-only", "--no-renames", base, branch],
      cwd,
    );
    if (!dif.ok) {
      linhas.push(`${f.nome.padEnd(28)} ERRO no git diff: ${dif.err}`);
      continue;
    }
    const viol = conferirAlterados(f, manifesto, dif.nomes).length;
    const risco = riscosDoDiff(base, branch, dif.nomes, cwd);
    linhas.push(
      `${f.nome.padEnd(28)} commits+${String(aMais).padEnd(3)} sujo:${String(sujo).padEnd(3)} fora-da-faixa:${viol}${risco.length ? `  RISCO:${risco.length}` : ""}`,
    );
  }
  console.log(linhas.join("\n"));
}

/**
 * Frentes que tocam o mapa de risco, pelos CAMINHOS do diff. Cada uma EXIGE `revisor-risco`:
 * a etiqueta que a frente ou o planejador deram ao próprio trabalho não rebaixa isto.
 */
function imprimirRiscos(plano) {
  const comRisco = plano.filter((p) => p.riscos.length > 0);
  if (comRisco.length === 0) return;
  console.log(
    "\n⚠ MAPA DE RISCO — `revisor-risco` é OBRIGATÓRIO nestas frentes:",
  );
  for (const p of comRisco) {
    console.log(`  - ${p.frente}`);
    for (const [arq, motivo] of p.riscos)
      console.log(`      ${arq}  (${motivo})`);
  }
}

function cmdIntegrar(args) {
  const cwd = process.cwd();
  const [arg, ...resto] = args;
  const { manifesto } = carregarManifesto(arg, cwd);
  validarOuSair(manifesto, cwd, { piso: false });
  // Roda na árvore principal OU num worktree de integração (limpo, em branch própria) — assim o
  // integrador não precisa trocar de ramo na árvore compartilhada (AGENTS.md: nunca `checkout` lá).
  // Nunca dentro do worktree de uma FRENTE: ela não integra o trabalho das outras.
  if (existsSync(join(raizDoWorktree(cwd), LANE_FILE)))
    falhar("`integrar` não roda dentro do worktree de uma frente");
  const escopoIdx = resto.indexOf("--escopo");
  const escopo = escopoIdx >= 0 ? resto[escopoIdx + 1] : "tooling";
  const soConferir = resto.includes("--so-conferir");
  const mapa = mapaDeBranches(resto);
  const atual = git(["branch", "--show-current"], cwd).out;
  if (!atual)
    falhar("HEAD solto: entre numa branch de integração antes de integrar");
  // `.worktrees/` é a pasta de trabalho desta própria ferramenta: não conta como sujeira
  // mesmo num repo que (ainda) não a ignora.
  const sujo = git(
    ["status", "--porcelain", "--", ".", ":(exclude).worktrees"],
    cwd,
  ).out;
  if (sujo)
    falhar(
      `a árvore principal tem mudanças não commitadas — commite ou separe antes:\n${sujo}`,
    );

  // Passada 1: provar TODAS as faixas antes de juntar qualquer coisa.
  const plano = [];
  let reprovado = false;
  for (const f of manifesto.frentes) {
    const branch = mapa.get(f.nome) ?? nomeDaBranch(manifesto, f.nome);
    // SHA conferido = SHA mesclado. Mesclar pelo NOME da branch deixaria um commit feito na
    // frente DEPOIS da conferência (frente ainda viva, ou um hook durante o merge) entrar sem ter
    // sido provado nem revisado — inclusive arquivo compartilhado.
    const resolvido = git(
      ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`],
      cwd,
    );
    if (!resolvido.ok) {
      console.error(`✗ ${f.nome}: branch ${branch} não existe`);
      reprovado = true;
      continue;
    }
    const sha = resolvido.out;
    const base = git(["merge-base", "HEAD", sha], cwd).out;
    const dif = nomesZ(
      ["diff", "-z", "--name-only", "--no-renames", base, sha],
      cwd,
    );
    if (!dif.ok) {
      // Falha do git NÃO pode virar "sem alterações, pulada": esconderia a frente.
      console.error(`✗ ${f.nome}: git diff falhou em ${branch}: ${dif.err}`);
      reprovado = true;
      continue;
    }
    const alterados = dif.nomes;
    const viol = conferirAlterados(f, manifesto, alterados);
    if (viol.length) {
      reprovado = true;
      console.error(`✗ ${f.nome}: ${viol.length} arquivo(s) fora da faixa`);
      for (const v of viol) console.error(`    - ${v.caminho}  (${v.motivo})`);
    }
    plano.push({
      frente: f.nome,
      branch,
      sha,
      arquivos: alterados.length,
      riscos: riscosDoDiff(base, sha, alterados, cwd),
    });
  }
  if (reprovado) falhar("nada foi integrado — corrija as frentes acima");
  if (soConferir) {
    console.log(
      `✓ ensaio: ${plano.length} frente(s) dentro da faixa, nada foi mesclado`,
    );
    for (const p of plano)
      console.log(`  - ${p.frente}: ${p.arquivos} arquivo(s) em ${p.branch}`);
    imprimirRiscos(plano);
    return;
  }

  // O merge passa pelo commit-msg (commitlint, header ≤ 100). Descobrir isso no meio do
  // caminho deixaria frentes já integradas e as demais não; confere TODAS antes de mesclar.
  const cabecalho = (frente) =>
    `chore(${escopo}): integra ${frente} (${manifesto.plano})`;
  for (const p of plano) {
    if (cabecalho(p.frente).length > 100) {
      falhar(
        `a mensagem do merge de "${p.frente}" passa de 100 caracteres (commitlint): ${cabecalho(p.frente)}`,
      );
    }
  }

  // Passada 2: merge em ordem do manifesto. Faixas disjuntas => sem conflito;
  // se acontecer, a decomposição estava errada: aborta e diz onde.
  const feitas = [];
  for (const p of plano) {
    if (p.arquivos === 0) {
      console.log(`- ${p.frente}: sem alterações, pulada`);
      continue;
    }
    const m = git(["merge", "--no-ff", "-m", cabecalho(p.frente), p.sha], cwd);
    if (!m.ok) {
      // Arquivo não mesclado (índice com estágio ≥1) = conflito de verdade. Sem isso, o merge foi
      // RECUSADO por hook (commit-msg) ou erro do git — e dizer "decomposição errada" seria falso.
      const conflito = git(["ls-files", "-u"], cwd).out !== "";
      git(["merge", "--abort"], cwd);
      console.error(
        conflito
          ? `✗ conflito ao integrar "${p.frente}" (${p.branch}) — merge abortado.`
          : `✗ o merge de "${p.frente}" (${p.branch}) foi recusado SEM conflito (hook commit-msg ou erro do git) — merge abortado.`,
      );
      console.error(`  Já integradas: ${feitas.join(", ") || "nenhuma"}.`);
      if (conflito) {
        console.error(
          "  Conflito com faixas disjuntas = decomposição errada: reabra o plano.",
        );
      }
      console.error(m.err || m.out);
      process.exit(1);
    }
    feitas.push(p.frente);
    console.log(`✓ ${p.frente} (${p.arquivos} arquivo(s))`);
  }
  imprimirRiscos(plano);
  console.log(
    `\nIntegradas: ${feitas.length}/${plano.length} em ${atual}. Falta: o integrador aplicar os PEDIDOS de arquivos compartilhados e rodar /checar uma vez.`,
  );
}

function cmdLimpar([arg]) {
  const cwd = process.cwd();
  const { manifesto } = carregarManifesto(arg, cwd);
  validarOuSair(manifesto, cwd, { piso: false });
  if (existsSync(join(raizDoWorktree(cwd), LANE_FILE)))
    falhar("`limpar` não roda dentro do worktree de uma frente");
  for (const f of manifesto.frentes ?? []) {
    const branch = nomeDaBranch(manifesto, f.nome);
    const pasta = pastaDoWorktree(cwd, manifesto, f.nome);
    if (!existsSync(pasta)) continue;
    if (resolve(pasta) === raizDoWorktree(cwd)) continue; // nunca remove o worktree em que está
    const limpo = alteradosDesde("HEAD", pasta).length === 0;
    const integrada = git(
      ["merge-base", "--is-ancestor", branch, "HEAD"],
      cwd,
    ).ok;
    if (!limpo || !integrada) {
      console.log(
        `- ${f.nome}: MANTIDO (${!limpo ? "tem mudanças" : "ainda não integrado"})`,
      );
      continue;
    }
    // Sem `--force` desnecessário seria mais fraco: o worktree já foi provado limpo e integrado.
    // (O worktree não tem NENHUM link para a principal — ver `entrar` — então a remoção não
    // atravessa nada.)
    const rm = git(["worktree", "remove", "--force", pasta], cwd);
    if (!rm.ok) {
      console.log(`- ${f.nome}: MANTIDO (${rm.err})`);
      continue;
    }
    git(["branch", "-d", branch], cwd);
    console.log(`✓ ${f.nome}: worktree e branch removidos`);
  }
}

/* ───────────────────────── entrada ───────────────────────── */

const COMANDOS = {
  validar: cmdValidar,
  criar: cmdCriar,
  entrar: cmdEntrar,
  conferir: cmdConferir,
  commitar: cmdCommitar,
  status: cmdStatus,
  integrar: cmdIntegrar,
  limpar: cmdLimpar,
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [comando, ...args] = process.argv.slice(2);
  // `comando` vem do argv: um Map não herda `constructor`/`__proto__` do protótipo.
  const fn = new Map(Object.entries(COMANDOS)).get(comando);
  if (!fn) {
    console.error(`uso: frente.mjs <${Object.keys(COMANDOS).join("|")}> …`);
    process.exit(2);
  }
  fn(args);
}
