import { partesDoNucleoSemver } from "@/lib/versao-do-servidor";
import notas from "@/novidades/notas-das-versoes.json";

export interface NotaDaVersao {
  titulo: string;
  novidades: string[];
  correcoes: string[];
  melhorias: string[];
}

function ehListaDeTextos(valor: unknown): valor is string[] {
  return (
    Array.isArray(valor) &&
    valor.every(
      (texto: unknown) => typeof texto === "string" && texto.trim() !== "",
    )
  );
}

/** Também protege a leitura de notas antigas guardadas no aparelho. */
export function ehNotaDaVersao(valor: unknown): valor is NotaDaVersao {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return false;
  const campos = valor as Record<string, unknown>;
  return (
    typeof campos.titulo === "string" &&
    campos.titulo.trim() !== "" &&
    ehListaDeTextos(campos.novidades) &&
    ehListaDeTextos(campos.correcoes) &&
    ehListaDeTextos(campos.melhorias)
  );
}

function comparar(
  a: [number, number, number],
  b: [number, number, number],
): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** O pacote tem o texto de toda versão até `para`? Toda release publica a
 * própria nota, então ter uma nota igual ou mais nova que o destino prova que
 * este pacote foi montado depois dele. Pacote mais velho (aba aberta antes da
 * atualização) responde não: a faixa espera por quem conhece o destino. */
export function conheceNotasAte(para: string): boolean {
  const destino = partesDoNucleoSemver(para);
  const catalogo: unknown = notas;
  if (!destino || !catalogo || typeof catalogo !== "object") return false;
  if (Array.isArray(catalogo)) return false;
  return Object.entries(catalogo as Record<string, unknown>).some(
    ([versao, nota]) => {
      const partes = partesDoNucleoSemver(versao);
      return (
        partes !== null &&
        ehNotaDaVersao(nota) &&
        comparar(partes, destino) >= 0
      );
    },
  );
}

/** Sem origem conhecida, não anuncia todo o passado na primeira abertura. */
export function notasEntre(
  de: string | null,
  para: string,
): Array<{ versao: string; nota: NotaDaVersao }> {
  const destino = partesDoNucleoSemver(para);
  if (!destino) return [];
  const origem = de === null ? null : partesDoNucleoSemver(de);
  const catalogo: unknown = notas;
  if (!catalogo || typeof catalogo !== "object" || Array.isArray(catalogo)) {
    return [];
  }

  const selecionadas: Array<{
    versao: string;
    nota: NotaDaVersao;
    partes: [number, number, number];
  }> = [];
  const entradas = catalogo as Record<string, unknown>;
  for (const [versao, nota] of Object.entries(entradas)) {
    const partes = partesDoNucleoSemver(versao);
    if (!partes || !ehNotaDaVersao(nota)) continue;
    if (comparar(partes, destino) > 0) continue;
    const foraDaFaixa = origem
      ? comparar(partes, origem) <= 0
      : comparar(partes, destino) !== 0;
    if (foraDaFaixa) {
      continue;
    }
    selecionadas.push({ versao: partes.join("."), nota, partes });
  }

  selecionadas.sort((a, b) => comparar(a.partes, b.partes));
  return selecionadas.map(({ versao, nota }) => ({ versao, nota }));
}
