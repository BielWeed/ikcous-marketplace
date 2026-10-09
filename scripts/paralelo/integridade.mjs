/**
 * Integridade da faixa: o `.claude/lane.json` de um worktree é um arquivo que a
 * PRÓPRIA frente consegue reescrever (por `Bash`, que o hook não vê) — e o hook,
 * `conferir` e `commitar` leem a faixa dele. Sem esta verificação, uma frente
 * (ou um prompt injetado nela) alarga a própria faixa e passa a poder escrever em
 * `scripts/paralelo/`, de onde os subcomandos auto-aprovados executariam código dela.
 *
 * A defesa: a faixa só vale se o manifesto EMBUTIDO for idêntico ao manifesto
 * COMMITADO em `base` (o commit de que o worktree nasceu) no caminho `origem`, e
 * `origem` só pode ser um arquivo de `docs/superpowers/lanes/`. Forjar exige criar
 * um commit com o manifesto forjado — operação de git que pede confirmação.
 *
 * Limite honesto: contra um agente HOSTIL com `Bash` livre nada em processo é
 * garantia absoluta; a garantia final continua sendo `integrar`, que lê o manifesto
 * da árvore do integrador e reprova arquivo fora da faixa antes de qualquer merge.
 */
import { spawnSync } from "node:child_process";
import { normalizar } from "./faixas.mjs";

export const PASTA_DE_MANIFESTOS = "docs/superpowers/lanes/";

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
