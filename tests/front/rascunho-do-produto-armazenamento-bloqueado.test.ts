// @vitest-environment jsdom
//
// O rascunho do produto com o armazenamento do navegador bloqueado (r438-a).
//
// `lerRascunhoVigenteDoProduto` é chamada na montagem de "Novo produto" e de
// "Editar produto". Com o acesso a `localStorage` lançando SecurityError
// (Chrome com "bloquear dados de sites", política de empresa), a exceção
// derrubava a tela. Regra: rascunho indisponível = "sem rascunho", e apagar o
// rascunho nunca lança (quem apaga depois de salvar não pode virar erro).
import {
  PRAZO_DO_RASCUNHO_DO_PRODUTO_MS,
  apagarRascunhoDoProdutoPelaChave,
  descartarRascunhoDoProduto,
  lerRascunhoVigenteDoProduto,
} from "@/lib/rascunho-do-produto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CHAVE = "ikcous_product_form_draft:lojista-1";
const AGORA = 1_800_000_000_000;

function bloquearOAcesso(): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  };
}

describe("rascunho do produto — armazenamento bloqueado", () => {
  let armazem: Map<string, string>;
  let desbloquear: (() => void) | null;

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        armazem.set(k, v);
      },
      removeItem: (k: string) => {
        armazem.delete(k);
      },
    });
    desbloquear = null;
  });

  afterEach(() => {
    desbloquear?.();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("o acesso ao localStorage lança: ler vira 'sem rascunho'", () => {
    desbloquear = bloquearOAcesso();
    expect(lerRascunhoVigenteDoProduto(CHAVE, AGORA)).toBeNull();
  });

  it("só o getItem lança: ler vira 'sem rascunho'", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new DOMException("bloqueado", "SecurityError");
      },
      setItem: () => {},
      removeItem: () => {},
    });
    expect(lerRascunhoVigenteDoProduto(CHAVE, AGORA)).toBeNull();
  });

  it("rascunho vencido com o removeItem lançando: continua sendo 'sem rascunho'", () => {
    const vencido = JSON.stringify({
      name: "Antigo",
      salvoEm: AGORA - PRAZO_DO_RASCUNHO_DO_PRODUTO_MS - 1,
    });
    vi.stubGlobal("localStorage", {
      getItem: () => vencido,
      setItem: () => {},
      removeItem: () => {
        throw new DOMException("bloqueado", "SecurityError");
      },
    });
    expect(lerRascunhoVigenteDoProduto(CHAVE, AGORA)).toBeNull();
  });

  it("apagar com o armazenamento bloqueado não lança", () => {
    desbloquear = bloquearOAcesso();
    expect(() => apagarRascunhoDoProdutoPelaChave(CHAVE)).not.toThrow();
    expect(() => descartarRascunhoDoProduto("lojista-1")).not.toThrow();
  });

  it("controle: rascunho vigente volta como está; o vencido sai do aparelho", () => {
    const vigente = JSON.stringify({ name: "Novo", salvoEm: AGORA - 1000 });
    armazem.set(CHAVE, vigente);
    expect(lerRascunhoVigenteDoProduto(CHAVE, AGORA)).toBe(vigente);
    expect(armazem.has(CHAVE)).toBe(true);

    armazem.set(
      CHAVE,
      JSON.stringify({
        name: "Antigo",
        salvoEm: AGORA - PRAZO_DO_RASCUNHO_DO_PRODUTO_MS - 1,
      }),
    );
    expect(lerRascunhoVigenteDoProduto(CHAVE, AGORA)).toBeNull();
    expect(armazem.has(CHAVE)).toBe(false);
  });
});
