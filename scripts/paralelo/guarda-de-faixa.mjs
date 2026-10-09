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
 * - `--estrito` (hook no frontmatter do agente `frente`): fecha por padrão.
 *   Sem faixa registrada, ou com o alvo fora do worktree do próprio agente,
 *   bloqueia. É o que impede a frente de editar a árvore principal ou o worktree
 *   de outra frente.
 *
 * O que o hook NÃO cobre: escrita por Bash (`sed -i`, `>`, `cp`). Quem fecha
 * esse buraco é `frente.mjs conferir`/`commitar` (diff contra a base) e a
 * passada de `integrar`, que reprovam qualquer arquivo fora da faixa. O hook é
 * o aviso imediato; o diff é a garantia.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { arquivoPermitido, normalizar } from "./faixas.mjs";

const estrito = process.argv.includes("--estrito");

function bloquear(motivo) {
  process.stderr.write(`[guarda-de-faixa] ${motivo}\n`);
  process.exit(2);
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

/** Decisão pura, testável: devolve `null` (deixa passar) ou o motivo do bloqueio. */
export function decidir({ alvo, cwd, estritoAtivo }) {
  const abs = resolve(cwd, alvo);
  const doAlvo = acharLane(dirname(abs));
  const doCwd = acharLane(cwd);
  if (estritoAtivo) {
    if (!doCwd) {
      return (
        "esta frente não tem faixa registrada neste worktree. Rode primeiro:\n" +
        '  node "$CLAUDE_PROJECT_DIR/scripts/paralelo/frente.mjs" entrar <manifesto> <frente>\n' +
        "e edite só dentro do worktree isolado, nunca na árvore principal."
      );
    }
    if (!doAlvo || doAlvo.raiz !== doCwd.raiz) {
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
  try {
    const entrada = JSON.parse(await lerStdin());
    const alvo =
      entrada?.tool_input?.file_path ?? entrada?.tool_input?.notebook_path;
    if (!alvo) process.exit(0);
    const motivo = decidir({
      alvo,
      cwd: entrada.cwd ?? process.cwd(),
      estritoAtivo: estrito,
    });
    if (motivo) bloquear(motivo);
  } catch (e) {
    if (estrito)
      bloquear(
        `erro ao avaliar a faixa (fecha por padrão no modo estrito): ${e.message}`,
      );
  }
  process.exit(0);
}
