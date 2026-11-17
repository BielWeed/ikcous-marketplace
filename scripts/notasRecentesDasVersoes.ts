import type { Plugin } from "vite";
import { partesDoNucleoSemver } from "../src/lib/versao-do-servidor";

// O aparelho guarda no máximo 20 novidades (LIMITE em
// src/lib/novidades/armazenamento-local.ts) e mostra sempre as MAIS NOVAS. Uma
// nota além das 20 mais novas do catálogo nunca chega a ser guardada nem vista,
// mas o catálogo inteiro (uma nota nova por versão, hoje ~50 kB brotli) ia no
// pacote que TODO visitante baixa. Aqui só as 20 mais novas entram no pacote; o
// arquivo-fonte continua completo (histórico, release, teste de texto).
// tests/front/novidades/notas-no-pacote.test.ts roda o armazenamento real com e
// sem o corte e reprova se o LIMITE subir sem este número subir junto.
export const NOTAS_NO_PACOTE = 20;

const ARQUIVO_DAS_NOTAS = "/src/novidades/notas-das-versoes.json";

export function cortarNotasAntigas(json: string, limite: number): string {
  const catalogo: unknown = JSON.parse(json);
  if (!catalogo || typeof catalogo !== "object" || Array.isArray(catalogo))
    throw new Error("Notas das versões: o catálogo deve ser um objeto.");
  const entradas = Object.entries(catalogo).map(([versao, nota]) => {
    const partes = partesDoNucleoSemver(versao);
    if (!partes)
      throw new Error(`Notas das versões: versão ilegível "${versao}".`);
    return { versao, nota, partes };
  });
  const maisNovas = new Set(
    [...entradas]
      .sort(
        (a, b) =>
          b.partes[0] - a.partes[0] ||
          b.partes[1] - a.partes[1] ||
          b.partes[2] - a.partes[2],
      )
      .slice(0, limite)
      .map(({ versao }) => versao),
  );
  return JSON.stringify(
    Object.fromEntries(
      entradas
        .filter(({ versao }) => maisNovas.has(versao))
        .map(({ versao, nota }) => [versao, nota]),
    ),
  );
}

export function notasRecentesDasVersoes(): Plugin {
  let visto = false;
  return {
    name: "notas-recentes-das-versoes",
    enforce: "pre",
    apply: "build",
    buildStart() {
      visto = false;
    },
    transform(codigo, id) {
      const caminho = id.replaceAll("\\", "/").split("?")[0];
      if (!caminho.endsWith(ARQUIVO_DAS_NOTAS)) return null;
      visto = true;
      return { code: cortarNotasAntigas(codigo, NOTAS_NO_PACOTE), map: null };
    },
    generateBundle() {
      // Arquivo movido ou renomeado: sem isto o corte viraria um não-fazer
      // silencioso e o pacote voltaria a crescer uma nota por versão.
      if (!visto)
        throw new Error(
          `Notas das versões: ${ARQUIVO_DAS_NOTAS} não passou pelo corte; revisar o caminho.`,
        );
    },
  };
}
