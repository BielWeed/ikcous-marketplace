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
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  conferirAlterados,
  maiorPrefixoDeMigration,
  validarManifesto,
} from "./faixas.mjs";

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
  const candidatos = isAbsolute(arg)
    ? [arg]
    : [join(raizPrincipal(cwd), arg), join(cwd, arg)];
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
 * Artefatos que `entrar` coloca no worktree e que não são trabalho da frente:
 * o `node_modules` (SYMLINK — a regra `node_modules/` do .gitignore, com barra,
 * não casa symlink, então o git o vê como arquivo novo) e a própria faixa
 * (`.claude/lane.json`). Filtrar aqui vale também para base antiga sem a regra
 * `/node_modules`, ou para repo que não ignora `.claude/`.
 */
const ehArtefatoDaFrente = (c) =>
  c === "node_modules" ||
  c.startsWith("node_modules/") ||
  c === ".claude/lane.json";

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
  const lane = JSON.parse(readFileSync(arq, "utf8"));
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
  const { manifesto, caminho } = carregarManifesto(arg, cwd);
  validarOuSair(manifesto, cwd, { piso: false });
  acharFrente(manifesto, nome);
  const raiz = raizDoWorktree(cwd);
  const head = git(["rev-parse", "HEAD"], raiz);
  if (!head.ok) falhar(`git rev-parse HEAD falhou: ${head.err}`);
  mkdirSync(join(raiz, ".claude"), { recursive: true });
  writeFileSync(
    join(raiz, LANE_FILE),
    `${JSON.stringify({ plano: manifesto.plano, frente: nome, base: head.out, origem: caminho, manifesto }, null, 2)}\n`,
  );
  // node_modules do worktree = o da árvore principal (um `npm ci` por frente
  // custaria minutos e GB; o lockfile é compartilhado e só o integrador o muda).
  const principal = raizPrincipal(raiz);
  const destino = join(raiz, "node_modules");
  const origem = join(principal, "node_modules");
  let nm = "node_modules: já existe";
  if (!existsSync(destino)) {
    if (existsSync(origem)) {
      symlinkSync(origem, destino, "junction");
      nm = `node_modules: ligado a ${origem}`;
    } else {
      nm =
        "node_modules: AUSENTE na árvore principal — rode `npm ci` lá antes de verificar";
    }
  }
  console.log(`✓ frente "${nome}" registrada em ${raiz}`);
  console.log(`  base: ${head.out.slice(0, 8)} · ${nm}`);
  console.log(
    "  só escreva dentro da posse; compartilhado vira PEDIDO ao integrador, não edição.",
  );
}

function cmdCriar([arg, nome, ...resto]) {
  const cwd = process.cwd();
  const { manifesto } = carregarManifesto(arg, cwd);
  validarOuSair(manifesto, cwd);
  acharFrente(manifesto, nome);
  const i = resto.indexOf("--base");
  const base = i >= 0 ? resto[i + 1] : "HEAD";
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
  const add = git(["add", "--all", "--", ...alterados], raiz);
  if (!add.ok) falhar(`git add falhou: ${add.err}`);
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
    const alterados = nomesZ(
      ["diff", "-z", "--name-only", "--no-renames", base, branch],
      cwd,
    ).nomes;
    const viol = conferirAlterados(f, manifesto, alterados).length;
    linhas.push(
      `${f.nome.padEnd(28)} commits+${String(aMais).padEnd(3)} sujo:${String(sujo).padEnd(3)} fora-da-faixa:${viol}`,
    );
  }
  console.log(linhas.join("\n"));
}

function cmdIntegrar(args) {
  const cwd = process.cwd();
  const [arg, ...resto] = args;
  const { manifesto } = carregarManifesto(arg, cwd);
  validarOuSair(manifesto, cwd, { piso: false });
  if (ehWorktreeLigado(cwd))
    falhar("`integrar` roda na árvore PRINCIPAL, na branch de integração");
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
    if (
      !git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], cwd).ok
    ) {
      console.error(`✗ ${f.nome}: branch ${branch} não existe`);
      reprovado = true;
      continue;
    }
    const base = git(["merge-base", "HEAD", branch], cwd).out;
    const alterados = nomesZ(
      ["diff", "-z", "--name-only", "--no-renames", base, branch],
      cwd,
    ).nomes;
    const viol = conferirAlterados(f, manifesto, alterados);
    if (viol.length) {
      reprovado = true;
      console.error(`✗ ${f.nome}: ${viol.length} arquivo(s) fora da faixa`);
      for (const v of viol) console.error(`    - ${v.caminho}  (${v.motivo})`);
    }
    plano.push({ frente: f.nome, branch, arquivos: alterados.length });
  }
  if (reprovado) falhar("nada foi integrado — corrija as frentes acima");
  if (soConferir) {
    console.log(
      `✓ ensaio: ${plano.length} frente(s) dentro da faixa, nada foi mesclado`,
    );
    for (const p of plano)
      console.log(`  - ${p.frente}: ${p.arquivos} arquivo(s) em ${p.branch}`);
    return;
  }

  // Passada 2: merge em ordem do manifesto. Faixas disjuntas => sem conflito;
  // se acontecer, a decomposição estava errada: aborta e diz onde.
  const feitas = [];
  for (const p of plano) {
    if (p.arquivos === 0) {
      console.log(`- ${p.frente}: sem alterações, pulada`);
      continue;
    }
    const m = git(
      [
        "merge",
        "--no-ff",
        "-m",
        `chore(${escopo}): integra a frente ${p.frente} do plano ${manifesto.plano}`,
        p.branch,
      ],
      cwd,
    );
    if (!m.ok) {
      git(["merge", "--abort"], cwd);
      console.error(
        `✗ conflito ao integrar "${p.frente}" (${p.branch}) — merge abortado.`,
      );
      console.error(`  Já integradas: ${feitas.join(", ") || "nenhuma"}.`);
      console.error(
        "  Conflito com faixas disjuntas = decomposição errada: reabra o plano.",
      );
      console.error(m.err || m.out);
      process.exit(1);
    }
    feitas.push(p.frente);
    console.log(`✓ ${p.frente} (${p.arquivos} arquivo(s))`);
  }
  console.log(
    `\nIntegradas: ${feitas.length}/${plano.length} em ${atual}. Falta: o integrador aplicar os PEDIDOS de arquivos compartilhados e rodar /checar uma vez.`,
  );
}

function cmdLimpar([arg]) {
  const cwd = process.cwd();
  const { manifesto } = carregarManifesto(arg, cwd);
  if (ehWorktreeLigado(cwd)) falhar("`limpar` roda na árvore principal");
  for (const f of manifesto.frentes ?? []) {
    const branch = nomeDaBranch(manifesto, f.nome);
    const pasta = pastaDoWorktree(cwd, manifesto, f.nome);
    if (!existsSync(pasta)) continue;
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
    // O node_modules do worktree é um link: remova o link, não a pasta de verdade.
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
