// @vitest-environment jsdom
//
// P69 — Balcão de 1024 a 1279 px (ainda uma coluna): os 3 botões do item
// (diminuir, aumentar, remover) saíam do cartão. A lista de itens rola por
// dentro (`flex` em coluna + `overflow-y: auto`) e, sem `flex-shrink: 0`, o
// cartão encolhia abaixo da altura do conteúdo (68 px em vez de 93 px):
// 12 px de botão para fora a 1024x768, aba Buscar. De 1280 px para cima o
// `pdv.css` já tinha a correção (P54); aqui ela vale também a partir de 1024 px,
// como CLASSE `lg:shrink-0` no cartão — o css do P54 não se toca.
// O celular (< 1024 px) não muda: a lista de classes de antes está congelada
// como literal. O teste monta o Balcão REAL em jsdom e cai se a classe sair.
import {
  type EstadoDaVenda,
  estadoInicialDaVenda,
  serializarRascunho,
} from "@/hooks/useVendaPresencial";
import { AdminPdvView } from "@/views/admin/AdminPdvView";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock, functions: { invoke: vi.fn() } },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => true }));
vi.mock("@/components/admin/pdv/LeitorDeCodigo", () => ({
  LeitorDeCodigo: () => null,
}));

// O que o cartão do item tem no celular (< 1024 px): congelado como literal.
const CLASSES_DO_CELULAR = ["pdv-item"];
// O que o P69 acrescenta (e só isto): a correção de 1280 px, agora de 1024 px.
const CLASSES_NOVAS = ["lg:shrink-0"];

const AGORA = Date.parse("2026-11-06T15:00:00Z");
const HORA = 3_600_000;
const CHAVE_DO_RASCUNHO = "admin_pdv_venda_draft:lojista-1";

function vendaComItens(): EstadoDaVenda {
  const item = (id: string, nome: string) => ({
    chave: `${id}::`,
    productId: id,
    variantId: null,
    nome,
    variacao: null,
    preco: 10,
    quantidade: 1,
    estoque: 5,
    imagem: "",
  });
  return {
    ...estadoInicialDaVenda(() => "chave-p69"),
    etapa: "cupom",
    itens: [item("prod-1", "Caneca"), item("prod-2", "Prato")],
  };
}

async function capturar(passo?: string): Promise<HTMLElement> {
  const armazem = new Map<string, string>([
    [CHAVE_DO_RASCUNHO, serializarRascunho(vendaComItens(), AGORA - 2 * HORA)],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (c: string) => armazem.get(c) ?? null,
    setItem: (c: string, v: string) => {
      armazem.set(c, v);
    },
    removeItem: (c: string) => {
      armazem.delete(c);
    },
  });
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  rpcMock.mockReset();
  rpcMock.mockImplementation(async () => ({
    data: { data: [], total_count: 0 },
    error: null,
  }));
  const hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  const raiz = createRoot(hospedeiro);
  const avancar = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });
  };
  try {
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} />);
    });
    await avancar();
    if (passo) {
      const alvo = [...hospedeiro.querySelectorAll("button")].find((b) =>
        b.textContent?.includes(passo),
      );
      expect(alvo, `botão "${passo}" ausente`).toBeTruthy();
      await act(async () => {
        alvo?.click();
      });
      await avancar();
    }
    return hospedeiro.cloneNode(true) as HTMLElement;
  } finally {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
}

const SEL_CARTAO = ".pdv-cupom > ul > li";
const telas = new Map<string, HTMLElement>();

beforeAll(async () => {
  telas.set("camera", await capturar());
  telas.set("buscar", await capturar("Buscar"));
});

afterEach(() => {
  vi.useRealTimers();
});

function fichas(el: Element): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

/** Lança no primeiro desvio: celular literal + classes novas presentes. */
function conferirCartao(classes: readonly string[]): void {
  for (const c of CLASSES_DO_CELULAR) {
    expect(classes, `falta a classe do celular "${c}"`).toContain(c);
  }
  for (const c of CLASSES_NOVAS) {
    expect(classes, `falta a classe de 1024 px "${c}"`).toContain(c);
  }
  // Nada além do celular + o que o P69 acrescenta.
  expect([...classes].sort(), "classes do cartão").toEqual(
    [...CLASSES_DO_CELULAR, ...CLASSES_NOVAS].sort(),
  );
}

describe("P69 — Balcão de 1024 a 1279 px: o cartão do item não encolhe", () => {
  for (const aba of ["camera", "buscar"]) {
    it(`aba ${aba}: todo cartão do item tem as classes do celular e a de 1024 px`, () => {
      const cartoes = [...(telas.get(aba)?.querySelectorAll(SEL_CARTAO) ?? [])];
      expect(cartoes.length, "cartões do item").toBe(2);
      for (const cartao of cartoes) conferirCartao(fichas(cartao));
    });
  }

  it("o celular fica igual: as classes sem prefixo continuam as de antes", () => {
    const cartao = telas.get("camera")?.querySelector(SEL_CARTAO);
    const semPrefixo = fichas(cartao as Element).filter(
      (c) => !/^(sm|md|lg|xl|2xl):/.test(c),
    );
    expect(semPrefixo).toEqual(CLASSES_DO_CELULAR);
  });

  describe("controles: o teste cai quando a classe some (mutante em cópia)", () => {
    it("sem `lg:shrink-0`", () => {
      const cartao = telas.get("camera")?.querySelector(SEL_CARTAO);
      const mutante = fichas(cartao as Element).filter(
        (c) => c !== "lg:shrink-0",
      );
      expect(mutante).not.toEqual(fichas(cartao as Element));
      expect(() => conferirCartao(mutante)).toThrow(/lg:shrink-0/);
    });

    it("com `xl:` no lugar de `lg:` (a correção só de 1280 px)", () => {
      const cartao = telas.get("camera")?.querySelector(SEL_CARTAO);
      const mutante = fichas(cartao as Element).map((c) =>
        c === "lg:shrink-0" ? "xl:shrink-0" : c,
      );
      expect(() => conferirCartao(mutante)).toThrow(/lg:shrink-0/);
    });

    it("com classe de celular tirada", () => {
      const cartao = telas.get("camera")?.querySelector(SEL_CARTAO);
      const mutante = fichas(cartao as Element).filter((c) => c !== "pdv-item");
      expect(() => conferirCartao(mutante)).toThrow(/pdv-item/);
    });
  });
});
