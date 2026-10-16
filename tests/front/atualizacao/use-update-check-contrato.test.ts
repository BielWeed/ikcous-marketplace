// O CONTRATO do useUpdateCheck na atualização única e obrigatória, provado POR
// FONTE — o mesmo motivo dos testes-irmãos (portao-de-versao-fail-open,
// update-check-sonda-de-versao-sem-carimbo): o hook importa
// `virtual:pwa-register/react`, módulo virtual do vite-plugin-pwa que NÃO
// resolve neste runner (a fábrica do vi.mock não impede o vite:import-analysis
// de recusar o import; tentado e medido nesta peça, 16/10/2026). O
// COMPORTAMENTO das regras (momento seguro, abas, trava, rede da purga, veto
// local) é provado por unidade nos testes vizinhos; aqui se prova a COLAGEM.
import { describe, expect, it } from "vitest";

const FONTES = import.meta.glob<string>("/src/hooks/useUpdateCheck.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});
const [FONTE_CRUA = ""] = Object.values(FONTES);
const FONTE = FONTE_CRUA.replace(/\s+/g, " ");

/** O trecho entre dois marcadores (já normalizado), vazio se não achar. */
function trecho(de: string, ate: string): string {
  const i = FONTE.indexOf(de);
  if (i < 0) return "";
  const j = FONTE.indexOf(ate, i + de.length);
  return j < 0 ? "" : FONTE.slice(i, j);
}

describe("controle: o glob achou o fonte certo", () => {
  it("é o useUpdateCheck", () => {
    expect(Object.keys(FONTES)).toEqual(["/src/hooks/useUpdateCheck.ts"]);
    expect(FONTE).toContain("export function useUpdateCheck");
    expect(FONTE.length).toBeGreaterThan(3000);
  });
});

describe("veto local: onNeedReload", () => {
  it("o plugin recebe `onNeedReload` (substitui o reload automático de TODAS as abas) apontando para o registro de recarga pendente", () => {
    expect(FONTE).toContain("onNeedReload: marcarRecargaPendente");
    expect(FONTE).toContain(
      'import { marcarRecargaPendente } from "@/lib/atualizacao/recarga-pendente"',
    );
  });

  it("as opções vão por VARIÁVEL (o tsc local com o plugin 1.x não recusa propriedade em excesso) e não por literal direto", () => {
    expect(FONTE).toContain("const opcoesDoRegistro = {");
    expect(FONTE).toContain("useRegisterSW(opcoesDoRegistro)");
    expect(FONTE).not.toContain("useRegisterSW({");
  });
});

describe("versão obrigatória: não purga mais sozinha no boot", () => {
  const CHECAGEM = trecho(
    "const checkMandatoryUpdate = useCallback(",
    "useEffect(() => { checkMandatoryUpdate(); }",
  );

  it("controle: achou o corpo da checagem", () => {
    expect(CHECAGEM).toContain("isOlderThan(SAFE_APP_VERSION");
    expect(CHECAGEM.length).toBeGreaterThan(500);
  });

  it("a detecção só MARCA — nenhuma purga é chamada dentro dela", () => {
    expect({
      chamaPurga: CHECAGEM.includes("purgaDeVersaoObrigatoria("),
      chamaApply: CHECAGEM.includes("aplicarAtualizacaoPendenteERecarregar"),
      chamaNavegacao: CHECAGEM.includes("navegarPreservandoEndereco"),
      marca: CHECAGEM.includes("setObrigatoria(config.minAppVersion)"),
    }).toEqual({
      chamaPurga: false,
      chamaApply: false,
      chamaNavegacao: false,
      marca: true,
    });
  });

  it("só marca com a rede PROVADA (leitura recente de /version.json + navegador online); sem isso, busca e aguarda", () => {
    expect(CHECAGEM).toContain("redeVerificadaParaPurga({");
    expect(CHECAGEM).toContain("ultimaLeituraBemSucedidaEm: leituraDeVersaoEm");
    expect(CHECAGEM).toContain("navigator.onLine");
    expect(CHECAGEM).toContain("if (!redeProvada)");
  });

  it("a trava existente continua: chave pwa_mandatory_purge_guard, máx. 2", () => {
    expect(FONTE).toContain('"pwa_mandatory_purge_guard"');
    expect(FONTE).toContain("MAX_MANDATORY_PURGES = 2");
    expect(CHECAGEM).toContain("attempts >= MAX_MANDATORY_PURGES");
  });
});

describe("a purga real (só no caminho obrigatório)", () => {
  const PURGA = trecho(
    "const purgaDeVersaoObrigatoria = useCallback(",
    "const handleUpdate = useCallback(",
  );

  it("controle: achou o corpo da purga", () => {
    expect(PURGA).toContain("await apagarCachesDoApp()");
  });

  it("recusa sem rede e com operação sensível (defesa em profundidade) — lançando, para o instalador soltar a fase", () => {
    expect(PURGA).toContain("navigator.onLine === false");
    expect(PURGA).toContain("haOperacaoSensivel()");
    expect(PURGA.match(/throw new Error/g)?.length ?? 0).toBeGreaterThanOrEqual(
      5,
    );
  });

  it("gasta a trava existente no instante da purga e CONFIRMA lendo de volta; sem confirmar, não purga", () => {
    expect(PURGA).toContain("localStorage.setItem( MANDATORY_PURGE_GUARD_KEY");
    expect(PURGA).toContain("const confirmada = readPurgeGuard()");
    expect(PURGA).toContain("confirmada.count !== tentativas + 1");
    // a gravação da trava vem ANTES de qualquer apagamento
    expect(PURGA.indexOf("const confirmada = readPurgeGuard()")).toBeLessThan(
      PURGA.indexOf("await apagarCachesDoApp()"),
    );
  });

  it("grava origem + versão ESPERADA (a mínima exigida) antes de navegar", () => {
    expect(PURGA).toContain("gravaOrigemDeAtualizacao(SAFE_APP_VERSION)");
    expect(PURGA).toContain("gravaVersaoEsperadaDaAtualizacao(requerida)");
    expect(PURGA.indexOf("gravaVersaoEsperadaDaAtualizacao")).toBeLessThan(
      PURGA.indexOf("navegarPreservandoEndereco()"),
    );
  });

  it("as chaves pwa_* sobrevivem à purga (a trava não se apaga sozinha)", () => {
    expect(PURGA).toContain("chaveSobreviveAPurga(key)");
  });
});

describe("o apply e o valor retornado", () => {
  it("o apply escolhe: com versão obrigatória pendente, a purga; senão, o apply normal do SW (módulo único)", () => {
    const APPLY = trecho(
      "const handleUpdate = useCallback(",
      "// ==============================",
    );
    expect(APPLY).toContain("if (obrigatoria) {");
    expect(APPLY).toContain("await purgaDeVersaoObrigatoria(obrigatoria)");
    expect(APPLY).toContain("aplicarAtualizacaoPendenteERecarregar({");
  });

  it("o formato do retorno é o MESMO (as mesmas 5 chaves, inclusive o nome histórico performNuclearPurge)", () => {
    const RETORNO = FONTE.slice(FONTE.lastIndexOf("return { // Versão mínima"));
    for (const chave of [
      "isMandatory:",
      "updateAvailable:",
      "newVersion,",
      "checkUpdate:",
      "performNuclearPurge: handleUpdate",
    ]) {
      expect(RETORNO, chave).toContain(chave);
    }
  });

  it("`updateAvailable` cobre o SW novo E a versão obrigatória pendente", () => {
    expect(FONTE).toContain(
      "updateAvailable: needRefresh || obrigatoria !== null",
    );
    expect(FONTE).toContain("isMandatory: obrigatoria !== null");
  });
});
