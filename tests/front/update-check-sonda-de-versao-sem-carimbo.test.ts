// A SONDA DE VERSÃO SAI SEM CARIMBO DE TEMPO E COM `cache: "no-store"`.
//
// O carimbo `?t=<agora>` em `/version.json` existia para furar cache — e
// furava dois de uma vez: o cache HTTP do navegador E o cache do Service
// Worker, que grava POR URL. O preço era o vazamento medido em 08/09/2026:
// 20 polls = 20 entradas novas no cache do app instalado, que só somem quando
// a versão muda. Com o `sw.ts` ignorando `/version.json` (ele é sonda de
// frescor, não recurso cacheável — ver
// sw-version-json-nao-enche-o-cache.test.ts, que mede o listener REAL), sobra
// só o cache HTTP para furar, e quem faz isso é `cache: "no-store"`, que não
// inventa uma URL nova a cada busca.
//
// POR QUE ESTE TESTE LÊ O FONTE EM VEZ DE RENDERIZAR O HOOK — e o que isso
// deixa de provar: `useUpdateCheck.ts` importa `virtual:pwa-register/react`,
// módulo virtual do vite-plugin-pwa que NÃO resolve neste runner (o
// vitest.config.ts de propósito não carrega o plugin). Montar o hook exigiria
// mexer no config compartilhado do projeto, que está fora do escopo desta
// correção — a mesma decisão, pelo mesmo motivo, já registrada em
// localstorage-purge-whitelist-e-compartilhada.test.ts. Consequência honesta:
// aqui se prova a CHAMADA que o hook escreve, não a chamada que ele executa
// em tempo de execução. O comportamento do hook rodando não é medido por
// nenhum teste deste repositório.
//
// `import.meta.glob` com `?raw` é o padrão que os contratos de acessibilidade
// deste projeto já usam para ler fonte sem API de Node.
import { describe, expect, it } from "vitest";

const FONTES = import.meta.glob<string>("/src/hooks/useUpdateCheck.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

const CAMINHO = "/src/hooks/useUpdateCheck.ts";

// Sem acesso por chave variável (o eslint `security/detect-object-injection`
// reprova, e a catraca de lint reprova warning novo): o glob casa um arquivo
// só, então o valor sai por desestruturação.
const [FONTE_DO_HOOK = ""] = Object.values(FONTES);

/** Espaço em branco não é o assunto: o formatador pode quebrar a linha. */
function normalizar(texto: string): string {
  return texto.replace(/\s+/g, " ");
}

describe("useUpdateCheck — a busca de /version.json", () => {
  // CONTROLE: sem isto, todas as afirmações abaixo passariam contra um glob
  // vazio — "não contém o carimbo" é trivialmente verdadeiro numa string
  // vazia.
  it("controle: o glob achou o fonte do hook, e ele é o arquivo certo", () => {
    expect(Object.keys(FONTES)).toEqual([CAMINHO]);
    const src = FONTE_DO_HOOK;
    expect({
      temAFuncaoDaSonda: src.includes("const fetchServerVersion"),
      mencionaVersionJson: src.includes("/version.json"),
      tamanhoPlausivel: src.length > 1000,
    }).toEqual({
      temAFuncaoDaSonda: true,
      mencionaVersionJson: true,
      tamanhoPlausivel: true,
    });
  });

  it("busca /version.json SEM carimbo de tempo e com cache: no-store", () => {
    const src = normalizar(FONTE_DO_HOOK);

    expect({
      chamadaEscrita: src.includes(
        'fetch("/version.json", { cache: "no-store" })',
      ),
      temCarimboDeTempo: src.includes("version.json?"),
    }).toEqual({
      chamadaEscrita: true,
      temCarimboDeTempo: false,
    });
  });
});
