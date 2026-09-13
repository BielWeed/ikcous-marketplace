// CONTRATO DE FONTE dos arquivos que o harness não monta (issue #92).
//
// `useUpdateCheck.ts` importa `virtual:pwa-register/react`, módulo virtual
// do vite-plugin-pwa que NÃO resolve neste runner — o mesmo motivo de
// update-check-sonda-de-versao-sem-carimbo.test.ts. `main.tsx` monta o app
// inteiro; `silent-guardian.js` é estático. Para os três, o contrato se
// prova na FONTE, com o CONTROLE do glob (afirmar que o arquivo certo foi
// lido) — string in, boolean out, o mesmo padrão dos contratos de
// acessibilidade.
//
// O que este arquivo cobra:
//   · o hook NÃO tem mais mecanismo próprio de chunk (chave
//     `pwa_chunk_error_reload`, listener 'error') e NÃO navega com
//     `?forceUpdate=`/`location.href`;
//   · o hook DELEGA ao módulo único: caches seletivos, deleteDatabase
//     aguardado, navegação preservando endereço;
//   · o silent-guardian mantém o ponto de sincronização da build (que o
//     identityBuildConfig substitui pela versão entregue) e NÃO é dono de
//     recuperação;
//   · o main.tsx instala os canais globais de chunk;
//   · o sentinela pede recarga pela chave única e tenta o waiting antes de
//     desregistrar.
import { describe, expect, it } from "vitest";

const FONTES = import.meta.glob<string>(
  [
    "/src/hooks/useUpdateCheck.ts",
    "/public/silent-guardian.js",
    "/src/main.tsx",
    "/src/pwa-sentinel.ts",
  ],
  { query: "?raw", import: "default", eager: true },
);

/** Espaço em branco não é o assunto: o formatador pode quebrar a linha. */
function normalizar(texto: string): string {
  return texto.replace(/\s+/g, " ");
}

describe("controle: o glob leu exatamente os quatro arquivos", () => {
  it("os quatro fontes existem e são plausíveis", () => {
    expect(Object.keys(FONTES).sort()).toEqual(
      [
        "/public/silent-guardian.js",
        "/src/hooks/useUpdateCheck.ts",
        "/src/main.tsx",
        "/src/pwa-sentinel.ts",
      ].sort(),
    );
    for (const fonte of Object.values(FONTES)) {
      expect(fonte.length).toBeGreaterThan(500);
    }
  });
});

describe("useUpdateCheck — sem mecanismo próprio de chunk, delegando ao módulo único", () => {
  const FONTE = normalizar(FONTES["/src/hooks/useUpdateCheck.ts"] ?? "");

  it("não sobra NENHUMA peça do mecanismo concorrente antigo", () => {
    expect({
      chaveAntigaDeChunk: FONTE.includes("pwa_chunk_error_reload"),
      listenerGlobalDeErro: FONTE.includes('window.addEventListener("error"'),
      purgaQueDisparavaPorChunk: FONTE.includes(
        "performNuclearPurge(true), 1500",
      ),
    }).toEqual({
      chaveAntigaDeChunk: false,
      listenerGlobalDeErro: false,
      purgaQueDisparavaPorChunk: false,
    });
  });

  it("a navegação não empilha ?forceUpdate nem usa location.href (aceite 6)", () => {
    expect({
      paramSemConsumidor: FONTE.includes("forceUpdate"),
      navegacaoPorHref: FONTE.includes("window.location.href"),
      navegacaoPeloModuloUnico: FONTE.includes("navegarPreservandoEndereco()"),
    }).toEqual({
      paramSemConsumidor: false,
      navegacaoPorHref: false,
      navegacaoPeloModuloUnico: true,
    });
  });

  it("o purge obrigatório usa os procedimentos seguros do módulo único", () => {
    expect({
      cachesSoDoApp: FONTE.includes("apagarCachesDoApp()"),
      deleteDatabaseAguardado: FONTE.includes(
        "await apagarIndexedDBAguardando()",
      ),
    }).toEqual({
      cachesSoDoApp: true,
      deleteDatabaseAguardado: true,
    });
  });

  it("o hook continua sem apagar IndexedDB POR CONTA PRÓPRIA (sem request solto)", () => {
    expect(FONTE.includes("indexedDB.deleteDatabase")).toBe(false);
  });
});

describe("silent-guardian — splash e fallback do loader, NUNCA dono", () => {
  const FONTE = FONTES["/public/silent-guardian.js"] ?? "";

  it("o ponto de sincronização da build continua no arquivo (o identityBuildConfig o exige e o substitui)", () => {
    // O token "1773003981700" NÃO é linha morta: o plugin de identidade da
    // build o exige e o substitui pela versão entregue
    // (scripts/identityBuildConfig.ts; testes identity-build-*). O conserto
    // da issue #92 aqui é o guardian NUNCA DECIDIR — não apagar o marcador.
    expect(FONTE.includes('__APP_VERSION__ = "1773003981700"')).toBe(true);
  });

  it("não desregistra SW, não apaga cache e não recarrega a página", () => {
    const fonte = normalizar(FONTE);
    expect({
      unregister: fonte.includes("unregister"),
      // `caches.delete` (a API), não a palavra: o histórico do Ghost Purge
      // citado em comentário diz "caches" em prosa — e a régua Deno N5
      // (tests/pwa_navegacao_offline_test.ts) mede a API pelo mesmo motivo.
      caches: fonte.includes("caches.delete"),
      reload: fonte.includes("location.reload"),
    }).toEqual({ unregister: false, caches: false, reload: false });
  });
});

describe("main.tsx — os canais globais nascem no chunk inicial", () => {
  const FONTE = normalizar(FONTES["/src/main.tsx"] ?? "");

  it("instala instalarCanaisDeErroChunk() fora de qualquer lazy", () => {
    expect(FONTE.includes("instalarCanaisDeErroChunk()")).toBe(true);
  });
});

describe("pwa-sentinel — subordinado à chave única, waiting primeiro", () => {
  const FONTE = normalizar(FONTES["/src/pwa-sentinel.ts"] ?? "");

  it("pede recarga pela chave única e tenta o waiting antes de desregistrar", () => {
    expect({
      subordinado: FONTE.includes("pedirRecargaSubordinada()"),
      waitingPrimeiro: FONTE.includes("assumirServiceWorkerNovoERecarregar("),
      desregistroAindaExisteComoUltimoRecurso: FONTE.includes("unregister()"),
    }).toEqual({
      subordinado: true,
      waitingPrimeiro: true,
      desregistroAindaExisteComoUltimoRecurso: true,
    });
  });
});
