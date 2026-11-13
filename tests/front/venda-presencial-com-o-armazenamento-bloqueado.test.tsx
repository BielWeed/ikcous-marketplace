// @vitest-environment jsdom
//
// O BALCÃO ABRE COM O ARMAZENAMENTO DO NAVEGADOR BLOQUEADO (caça, r438-a).
//
// Chrome com "Bloquear todos os cookies e dados de sites" e política de
// empresa fazem o próprio ACESSO a `window.localStorage` lançar
// SecurityError. `armazenamentoPadrao()` devolvia `window.localStorage` sem
// proteção e é chamada no RENDER do hook: a exceção subia ao error boundary e
// a tela do balcão mostrava "Algo deu errado" — a lojista não vendia. Sem
// armazenamento, o balcão abre igual e o rascunho simplesmente não é guardado
// (a venda segue viva em memória), o mesmo que já acontece sem DOM.
import {
  type VendaPresencialEmUso,
  estadoInicialDaVenda,
  serializarRascunho,
  useVendaPresencial,
} from "@/hooks/useVendaPresencial";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE = "admin_pdv_venda_draft:lojista-1";

function Sonda({
  aoRenderizar,
}: { readonly aoRenderizar: (venda: VendaPresencialEmUso) => void }) {
  aoRenderizar(useVendaPresencial({ userId: "lojista-1" }));
  return null;
}

/** O bloqueio de verdade: o ACESSO à propriedade lança, como no navegador. */
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

describe("useVendaPresencial — o balcão abre com o armazenamento bloqueado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let desbloquear: (() => void) | null;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    desbloquear?.();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("acesso ao localStorage lança: o balcão renderiza, sem rascunho, e o cupom vive em memória", async () => {
    desbloquear = bloquearOAcesso();
    const vendas: VendaPresencialEmUso[] = [];

    await act(async () => {
      raiz.render(<Sonda aoRenderizar={(v) => vendas.push(v)} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const venda = vendas.at(-1);
    expect(venda).toBeDefined();
    expect(venda?.restaurado).toBe(false);
    expect(venda?.rascunhoAntigo).toBeNull();
    expect(venda?.estado.itens).toEqual([]);
    // "Descartar" / limpar o cupom também não pode lançar sem armazenamento.
    await act(async () => {
      venda?.limparCupom();
    });
    expect(vendas.at(-1)?.estado.itens).toEqual([]);
  });

  it("controle: com armazenamento normal o cupom gravado volta ao abrir", async () => {
    armazem.set(
      CHAVE,
      serializarRascunho(
        {
          ...estadoInicialDaVenda(() => "chave-1"),
          itens: [
            {
              chave: "prod-1::",
              productId: "prod-1",
              variantId: null,
              nome: "Caneca da Maria",
              variacao: null,
              preco: 10,
              quantidade: 1,
              estoque: 5,
              imagem: "",
            },
          ],
        },
        Date.now(),
      ),
    );
    const vendas: VendaPresencialEmUso[] = [];

    await act(async () => {
      raiz.render(<Sonda aoRenderizar={(v) => vendas.push(v)} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(vendas.at(-1)?.restaurado).toBe(true);
    expect(vendas.at(-1)?.estado.itens).toHaveLength(1);
  });
});
