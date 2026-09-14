/**
 * O CONTRATO ÚNICO de `/version.json` (peça "tela de atualização", 14/09).
 *
 * Até aqui a regra "o que conta como versão legível" existia SÓ na sonda de
 * rede do `recuperacao-chunk.ts` (status ok + content-type json + campo
 * `version` string); o portão do `useUpdateCheck.ts` tinha uma leitura MAIS
 * FRACA e divergente (`response.ok` → `.json()` → `data.version` sem validar
 * tipo). Em dev/prévia o dev server responde `/version.json` com o
 * index.html do app (fallback de SPA — medido: 200 text/html em 5174, 5175 e
 * 5176) e a produção responde JSON real (medido: application/json na Vercel).
 * Lição #53: regra escrita em dois lugares diverge — aqui ficou a ÚNICA
 * definição, e os dois consumidores leem daqui.
 *
 * FAIL-OPEN no portão: devolve `null` para QUALQUER resposta que não seja
 * uma versão legível — 404, HTML, corpo que não faz parse, campo ausente,
 * não-string, vazio. `null` significa "SEM INFORMAÇÃO DE VERSÃO = sem
 * atualização": nunca decisão de update, overlay eterno ou versão inventada
 * na tela. (A sonda do recuperacao-chunk mantém a leitura fail-CLOSED de
 * propósito — lá, "não deu para provar a rede" tem de recusar o purge.)
 */

/** O núcleo numérico de uma versão: `"1.32.0-sha.2526bdd"` → `[1, 32, 0]`.
 * A versão de build sempre carrega sufixo (`-sha.x`, `+build.y`), então
 * comparação e exibição usam SÓ o núcleo. Formato desconhecido → `null`. */
export function partesDoNucleoSemver(
  versao: string,
): [number, number, number] | null {
  const core = versao.trim().split(/[-+]/)[0];
  const partes = core.split(".").map((p) => Number.parseInt(p, 10));
  if (partes.length === 0 || partes.length > 3) return null;
  if (partes.some((n) => Number.isNaN(n))) return null;
  const [major = 0, minor = 0, patch = 0] = partes;
  return [major, minor, patch];
}

/** O que a TELA mostra de uma versão: o núcleo semver limpo
 * (`"1.32.0-sha.2526bdd"` → `"1.32.0"`). Era o `v.slice(-6)` do aviso de
 * atualização, que exibia o fragmento do hash (`526bdd`) — o "código
 * estranho" da peça. Sem núcleo legível → `null`: quem exibe NÃO exibe. */
export function nucleoSemver(versao: string | null | undefined): string | null {
  if (!versao) return null;
  const partes = partesDoNucleoSemver(versao);
  return partes ? partes.join(".") : null;
}

/** A leitura ÚNICA da resposta de `/version.json`: só vale status ok +
 * content-type json declarado + corpo JSON com campo `version` string não
 * vazia. O content-type declarado é o que um portal cativo / proxy mentindo
 * não finge — mesma decisão da sonda. Qualquer outra resposta → `null`. */
export async function versaoLegivelDeResposta(
  resposta: Response,
): Promise<string | null> {
  if (!resposta.ok) return null;
  const tipo = resposta.headers.get("content-type") ?? "";
  if (!tipo.includes("json")) return null;
  try {
    const corpo = (await resposta.json()) as { version?: unknown };
    const versao = corpo?.version;
    if (typeof versao !== "string") return null;
    return versao.trim() === "" ? null : versao;
  } catch {
    // content-type json com corpo que não faz parse: sem versão.
    return null;
  }
}
