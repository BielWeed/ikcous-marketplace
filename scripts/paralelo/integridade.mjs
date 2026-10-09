/* eslint-disable security/detect-non-literal-fs-filename --
 * O único caminho lido/gravado é `<gitdir>/paralelo-ancora.json`: o gitdir vem do próprio git
 * (`rev-parse --absolute-git-dir`) e o nome do arquivo é constante. Nunca há entrada de rede. */
/**
 * Integridade da faixa: o `.claude/lane.json` de um worktree é um arquivo que a
 * PRÓPRIA frente consegue reescrever (por `Bash`, que o hook não vê) — e o hook,
 * `conferir` e `commitar` leem a faixa dele. Sem esta verificação, uma frente
 * (ou um prompt injetado nela) alarga a própria faixa e passa a poder escrever em
 * `scripts/paralelo/`, de onde os subcomandos auto-aprovados executariam código dela.
 *
 * A defesa tem duas peças:
 *
 * 1. O manifesto EMBUTIDO tem que ser idêntico ao manifesto COMMITADO em `base` no caminho
 *    `origem`, e `origem` só pode ser um arquivo de `docs/superpowers/lanes/`. Forjar exige criar
 *    um commit com o manifesto forjado — operação de git que pede confirmação.
 * 2. Mas só isso aceita QUALQUER `base` ancestral e QUALQUER `frente` do manifesto: um lane.json
 *    com só o nome trocado (outra frente do mesmo manifesto) ou com `base` num commit antigo cujo
 *    manifesto era mais largo passava (re-revisão do #782, B2). Por isso `entrar` grava uma ÂNCORA
 *    — plano, frente, base e origem — no gitdir do worktree (`.git/worktrees/<nome>/`, fora da
 *    árvore de trabalho e fora do alcance de `Write`/`Edit`, que o hook estrito bloqueia por estar
 *    fora do worktree), e a faixa só vale se o lane.json CONCORDAR com ela. Em worktree criado por
 *    `criar` o nome ainda fica amarrado ao ramo `paralelo/<plano>/<frente>`, que a âncora não
 *    precisa guardar.
 *
 * Limite honesto: contra um agente HOSTIL com `Bash` livre nada em processo é garantia absoluta —
 * quem escreve no gitdir por Bash escreve a âncora também. O que isto fecha é o caminho barato
 * (editar o lane.json, com ou sem aprovação de Bash); a garantia final continua sendo `integrar`,
 * que lê o manifesto da árvore do integrador e reprova arquivo fora da faixa antes de qualquer merge.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizar } from "./faixas.mjs";

export const PASTA_DE_MANIFESTOS = "docs/superpowers/lanes/";
export const ARQUIVO_DA_ANCORA = "paralelo-ancora.json";
const RAMO_DE_FRENTE = /^paralelo\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$/;

/** `origem` tem que ser um .json direto de docs/superpowers/lanes/, sem `..`. */
export function origemValida(origem) {
  const n = normalizar(origem ?? "");
  return (
    n.startsWith(PASTA_DE_MANIFESTOS) &&
    n.endsWith(".json") &&
    !n.split("/").includes("..") &&
    !n.slice(PASTA_DE_MANIFESTOS.length).includes("/")
  );
}

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, out: r.stdout ?? "" };
}

/** Caminho da âncora deste worktree (dentro do gitdir dele), ou `null` se não é um repositório git. */
export function caminhoDaAncora(raiz) {
  const r = git(
    ["rev-parse", "--path-format=absolute", "--absolute-git-dir"],
    raiz,
  );
  const dir = r.out.trim();
  return r.ok && dir ? join(dir, ARQUIVO_DA_ANCORA) : null;
}

/**
 * Grava a âncora. `wx`: nunca sobrescreve — a âncora existente é a que vale, e um `entrar`
 * repetido (inclusive depois de o lane.json ser apagado) é recusado por quem chama.
 */
export function gravarAncora(raiz, { plano, frente, base, origem }) {
  const caminho = caminhoDaAncora(raiz);
  if (!caminho) throw new Error("não achei o gitdir deste worktree");
  writeFileSync(
    caminho,
    `${JSON.stringify({ versao: 1, plano, frente, base, origem: normalizar(origem) }, null, 2)}\n`,
    { flag: "wx" },
  );
  return caminho;
}

/** `{ ancora }` ou `{ erro }` (frase para o agente/dono). */
export function lerAncora(raiz) {
  const caminho = caminhoDaAncora(raiz);
  if (!caminho) return { erro: "não achei o gitdir deste worktree" };
  let texto;
  try {
    texto = readFileSync(caminho, "utf8");
  } catch {
    return {
      erro: "este worktree está sem âncora (foi registrado por uma versão anterior das frentes, ou a âncora foi apagada) — recrie o worktree: `frente.mjs limpar` e `criar` (ou despache a frente de novo)",
    };
  }
  let ancora;
  try {
    ancora = JSON.parse(texto);
  } catch {
    return { erro: "a âncora do worktree está ilegível — recrie o worktree" };
  }
  if (
    !ancora ||
    typeof ancora !== "object" ||
    [ancora.plano, ancora.frente, ancora.base, ancora.origem].some(
      (v) => typeof v !== "string" || v === "",
    )
  ) {
    return { erro: "a âncora do worktree está malformada — recrie o worktree" };
  }
  return { ancora };
}

/**
 * Ramo `paralelo/<plano>/<frente>` do worktree (o que `criar` dá), ou `null` para qualquer outro
 * (worktree nativo de subagente tem `worktree-agent-<id>`; HEAD solto não tem ramo).
 */
export function ramoDaFrente(raiz) {
  const nome = git(["branch", "--show-current"], raiz).out.trim();
  const m = RAMO_DE_FRENTE.exec(nome);
  return m ? { nome, plano: m[1], frente: m[2] } : null;
}

const curto = (sha) => String(sha).slice(0, 8);

/** `null` se a faixa é íntegra; senão o motivo (frase para o agente/dono). */
export function verificarFaixa(raiz, lane) {
  if (
    !lane ||
    typeof lane !== "object" ||
    typeof lane.plano !== "string" ||
    typeof lane.frente !== "string" ||
    typeof lane.base !== "string" ||
    typeof lane.origem !== "string" ||
    !lane.manifesto ||
    typeof lane.manifesto !== "object"
  ) {
    return "lane.json malformado";
  }
  if (!origemValida(lane.origem)) {
    return `origem fora de ${PASTA_DE_MANIFESTOS}: ${lane.origem}`;
  }
  // A âncora (no gitdir) é a memória do `entrar`: base, frente, plano e origem não podem ser outros.
  const lida = lerAncora(raiz);
  if (lida.erro) return lida.erro;
  const { ancora } = lida;
  if (lane.base !== ancora.base) {
    return `a base da faixa (${curto(lane.base)}) não é o commit em que o worktree nasceu (${curto(ancora.base)}) — faixa adulterada`;
  }
  if (lane.plano !== ancora.plano || lane.frente !== ancora.frente) {
    return `a frente da faixa (${lane.plano}/${lane.frente}) não é a que este worktree registrou (${ancora.plano}/${ancora.frente}) — faixa adulterada`;
  }
  if (normalizar(lane.origem) !== normalizar(ancora.origem)) {
    return `a origem da faixa (${lane.origem}) difere da registrada (${ancora.origem}) — faixa adulterada`;
  }
  // Worktree de `criar`: o ramo diz quem ele é, sem depender da âncora.
  const ramo = ramoDaFrente(raiz);
  if (ramo && (ramo.plano !== lane.plano || ramo.frente !== lane.frente)) {
    return `o ramo ${ramo.nome} é da frente ${ramo.plano}/${ramo.frente}, mas a faixa diz ${lane.plano}/${lane.frente} — faixa adulterada`;
  }
  const bloco = git(["show", `${lane.base}:${normalizar(lane.origem)}`], raiz);
  if (!bloco.ok)
    return "o manifesto da faixa não existe no commit base (foi commitado antes de despachar?)";
  let canonico;
  try {
    canonico = JSON.parse(bloco.out);
  } catch {
    return "o manifesto commitado não é JSON válido";
  }
  if (JSON.stringify(canonico) !== JSON.stringify(lane.manifesto)) {
    return "faixa adulterada: o manifesto embutido difere do commitado";
  }
  if (canonico.plano !== lane.plano)
    return "plano da faixa difere do manifesto";
  if (!git(["merge-base", "--is-ancestor", lane.base, "HEAD"], raiz).ok) {
    return "a base da faixa não é ancestral do HEAD deste worktree";
  }
  return null;
}
