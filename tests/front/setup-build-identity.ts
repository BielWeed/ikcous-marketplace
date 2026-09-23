import { beforeEach, vi } from "vitest";
import { buildIdentityFixture } from "./fixtures/build-identity";

function instalarFixture() {
  vi.stubGlobal("__STORE_IDENTITY__", buildIdentityFixture);
}

// CHECKOUT COMPACTO + CPF (23/09/2026) — achado de infraestrutura, não do
// código do app: Node 25 liga por padrão um `globalThis.localStorage`
// EXPERIMENTAL próprio (`--localstorage-file`, sem caminho válido — o aviso
// "was provided without a valid path" aparece até num `node -e` vazio, sem
// nenhum código deste repositório carregado). Esse objeto não tem `.clear`
// nem `.length`, e ele CHEGA ANTES do `localStorage` de verdade que o
// ambiente `jsdom` do Vitest instalaria — os testes que confiam no
// `localStorage` nativo do jsdom (sem o próprio `vi.stubGlobal`, que a
// maioria dos arquivos já faz) quebram com "localStorage.clear is not a
// function". Rede de segurança MÍNIMA: só troca quando o que está lá NÃO
// é uma Storage completa — arquivo que já se stuba sozinho (`beforeEach`
// com `vi.stubGlobal("localStorage", ...)`) sobrescreve isto sem conflito.
function storageFalsoDoAmbiente(valor: unknown): boolean {
  return (
    typeof valor !== "object" ||
    valor === null ||
    typeof (valor as { clear?: unknown }).clear !== "function" ||
    typeof (valor as { getItem?: unknown }).getItem !== "function"
  );
}

function criarStorageDeReserva(): Storage {
  const armazem = new Map<string, string>();
  return {
    get length() {
      return armazem.size;
    },
    clear: () => armazem.clear(),
    getItem: (chave: string) => armazem.get(chave) ?? null,
    key: (indice: number) => [...armazem.keys()][indice] ?? null,
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, String(valor));
    },
  };
}

function corrigirStorageQuebradoDoNode() {
  if (storageFalsoDoAmbiente(globalThis.localStorage)) {
    vi.stubGlobal("localStorage", criarStorageDeReserva());
  }
  if (storageFalsoDoAmbiente(globalThis.sessionStorage)) {
    vi.stubGlobal("sessionStorage", criarStorageDeReserva());
  }
}

// Antes dos imports estáticos e novamente após testes que limpam os globals.
instalarFixture();
corrigirStorageQuebradoDoNode();
beforeEach(instalarFixture);
beforeEach(corrigirStorageQuebradoDoNode);
