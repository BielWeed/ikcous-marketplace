#!/usr/bin/env node
/* eslint-disable security/detect-non-literal-fs-filename --
 * Caminhos vêm do próprio git (rev-parse), de argumento da CLI do dev ou são
 * resolvidos contra a raiz do projeto — mesma convenção de scripts/db-apply.cjs.
 * Nunca há entrada de rede nem payload de terceiro. */
/**
 * Hook PreToolUse (Write|Edit|MultiEdit|NotebookEdit): uma frente paralela só
 * escreve dentro da própria faixa. Exit 2 = bloqueia e devolve o motivo ao agente.
 *
 * Dois modos, o mesmo código:
 *
 * - SEM flag (hook global em .claude/settings.json): só age se o arquivo-alvo
 *   mora num worktree que tem `.claude/lane.json`. Em qualquer outro lugar —
 *   sessão normal, árvore principal, orquestrador — deixa passar. Instalar esta
 *   guarda não muda nada para quem não usa frentes.
 * - ESTRITO (flag `--estrito`, ou `agent_type` = "frente" no JSON do harness): fecha por padrão.
 *   Sem faixa registrada, ou com o alvo fora do worktree do próprio agente,
 *   bloqueia. É o que impede a frente de editar a árvore principal ou o worktree
 *   de outra frente.
 *
 * A faixa só vale se for ÍNTEGRA (integridade.mjs): o `lane.json` é regravável pela própria
 * frente por `Bash`, então o manifesto embutido é comparado ao COMMITADO na base.
 * Symlink é resolvido (`realpath`) antes de decidir: um link dentro da posse que aponta para
 * o worktree de outra frente não pode contar como escrita "dentro da faixa".
 *
 * Fecha para a frente também quando um módulo (`faixas.mjs`, `integridade.mjs`) não carrega:
 * os imports são dinâmicos e ficam DENTRO do try. O Claude Code só bloqueia com exit 2 —
 * exit 1 (módulo ausente, sintaxe) e 127 deixam a escrita passar.
 *
 * O que o hook NÃO cobre: escrita por Bash (`sed -i`, `>`, `cp`). Quem fecha
 * esse buraco é `frente.mjs conferir`/`commitar` (diff contra a base) e a
 * passada de `integrar`, que reprovam qualquer arquivo fora da faixa. O hook é
 * o aviso imediato; o diff é a garantia.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const estrito = process.argv.includes("--estrito");

function bloquear(motivo) {
  process.stderr.write(`[guarda-de-faixa] ${motivo}\n`);
  process.exit(2);
}

/** `realpath` do maior ancestral que existe + o resto do caminho (o alvo pode ainda não existir). */
export function resolverReal(caminho) {
  const alvo = resolve(caminho);
  let atual = alvo;
  const resto = [];
  for (;;) {
    try {
      // `.native` devolve a CAIXA canônica do disco (`C:\\` × `c:\\` no Windows); o `realpathSync`
      // puro mantém a que foi digitada e gera comparação falsa entre o cwd e o alvo.
      return join(realpathSync.native(atual), ...[...resto].reverse());
    } catch {
      const pai = dirname(atual);
      if (pai === atual) return alvo;
      resto.push(basename(atual));
      atual = pai;
    }
  }
}

/** Mesmo caminho? Windows e macOS (disco do dono) não diferenciam maiúscula de minúscula. */
function mesmoCaminho(a, b) {
  return process.platform === "linux"
    ? a === b
    : a.toLowerCase() === b.toLowerCase();
}

/** Sobe a partir de `inicio` até achar `.claude/lane.json`; para na raiz do repo. */
export function acharLane(inicio) {
  let dir = resolve(inicio);
  for (;;) {
    const arq = join(dir, ".claude", "lane.json");
    if (existsSync(arq))
      return { raiz: dir, lane: JSON.parse(readFileSync(arq, "utf8")) };
    if (existsSync(join(dir, ".git"))) return null; // raiz do repo (principal ou worktree)
    const pai = dirname(dir);
    if (pai === dir) return null;
    dir = pai;
  }
}

/**
 * Decisão, testável: devolve `null` (deixa passar) ou o motivo do bloqueio.
 * `deps` traz as funções de faixas.mjs/integridade.mjs (carregadas por import dinâmico).
 */
export function decidir(
  { alvo, cwd, estritoAtivo },
  { arquivoPermitido, normalizar, verificarFaixa },
) {
  const cwdReal = resolverReal(cwd);
  const abs = resolverReal(resolve(cwdReal, alvo));
  const doAlvo = acharLane(dirname(abs));
  const doCwd = acharLane(cwdReal);
  for (const l of [doCwd, doAlvo]) {
    if (!l) continue;
    const motivo = verificarFaixa(l.raiz, l.lane);
    if (motivo) return `faixa não confiável em ${l.raiz}: ${motivo}.`;
  }
  if (estritoAtivo) {
    if (!doCwd) {
      return (
        "esta frente não tem faixa registrada neste worktree. Rode primeiro:\n" +
        "  node scripts/paralelo/frente.mjs entrar <manifesto> <frente>\n" +
        "e edite só dentro do worktree isolado, nunca na árvore principal."
      );
    }
    if (!doAlvo || !mesmoCaminho(doAlvo.raiz, doCwd.raiz)) {
      return `"${alvo}" está fora do worktree da frente "${doCwd.lane.frente}" (${doCwd.raiz}).`;
    }
  }
  if (!doAlvo) return null;
  const { raiz, lane } = doAlvo;
  const frente = (lane.manifesto?.frentes ?? []).find(
    (f) => f.nome === lane.frente,
  );
  if (!frente)
    return `faixa corrompida: frente "${lane.frente}" não está no manifesto embutido.`;
  const rel = normalizar(relative(raiz, abs));
  const r = arquivoPermitido(frente, lane.manifesto, rel);
  return r.ok
    ? null
    : `a frente "${lane.frente}" não pode escrever em ${rel}: ${r.motivo}. Se a mudança é necessária, descreva-a como PEDIDO no relatório final — o integrador aplica.`;
}

async function lerStdin() {
  const partes = [];
  for await (const p of process.stdin) partes.push(p);
  return Buffer.concat(partes).toString("utf8");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  // `ehFrente` fica FORA do try: o catch precisa dele. Se a frente corromper `.claude/lane.json`
  // (por Bash, que o hook não vê), `acharLane` lança — e um catch que olhasse só a flag
  // `--estrito` (que o harness real não passa) deixaria TODA escrita seguinte passar.
  let ehFrente = false;
  try {
    const entrada = JSON.parse(await lerStdin());
    // O harness manda `agent_type` nas chamadas de ferramenta de um subagente. Medido ao vivo:
    // o hook `--estrito` do frontmatter do agente `frente` NÃO dispara (só o global dispara),
    // então o modo estrito também liga aqui, por identidade do agente, sem depender do frontmatter.
    ehFrente = /(^|:)frente$/.test(String(entrada?.agent_type ?? ""));
    const alvo =
      entrada?.tool_input?.file_path ?? entrada?.tool_input?.notebook_path;
    if (!alvo) process.exit(0);
    // Dinâmico e DENTRO do try: módulo que não carrega vira catch → fecha para a frente.
    const faixas = await import("./faixas.mjs");
    const integridade = await import("./integridade.mjs");
    const motivo = decidir(
      {
        alvo,
        cwd: entrada.cwd ?? process.cwd(),
        estritoAtivo: estrito || ehFrente,
      },
      {
        arquivoPermitido: faixas.arquivoPermitido,
        normalizar: faixas.normalizar,
        verificarFaixa: integridade.verificarFaixa,
      },
    );
    if (motivo) bloquear(motivo);
  } catch (e) {
    if (estrito || ehFrente)
      bloquear(
        `erro ao avaliar a faixa (fecha por padrão no modo estrito): ${e.message}`,
      );
  }
  process.exit(0);
}
