import { readFileSync } from "node:fs";
// @vitest-environment jsdom
//
// Achado de revisão do PR #1721: o código que o balcão leu e "Cadastrar
// produto" guardou só era tomado quando o formulário de produto MONTAVA. Com o
// formulário ainda baixando, a lojista podia sair para "Produtos" e abrir
// OUTRO produto novo em menos de 2 minutos: o recado seguia guardado e
// preenchia esse cadastro com o código velho.
//
// Agora o recado é descartado em qualquer troca de tela que não termine no
// formulário de produto (`useDescartarCodigoParaCadastro`, ligado ao `view`
// do App). Aqui um roteador mínimo (mesmo `view` + o hook) liga os dois
// componentes de verdade, `CupomDaVenda` e `AdminProductFormView`, e deixa o
// teste controlar quando o formulário "termina de baixar".
import { CupomDaVenda } from "@/components/admin/pdv/CupomDaVenda";
import { useDescartarCodigoParaCadastro } from "@/hooks/useDescartarCodigoParaCadastro";
import { estadoInicialDaVenda } from "@/hooks/useVendaPresencial";
import type { View } from "@/types";
import { AdminProductFormView } from "@/views/admin/AdminProductFormView";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    upsertVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct: vi.fn().mockResolvedValue(null),
  }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "cat-1", name: "Geral", slug: "geral" }],
    addCategory: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn() },
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function botaoPorTexto(raizDom: ParentNode, texto: string): HTMLButtonElement {
  const achado = [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
  if (!achado) throw new Error(`botão ausente: ${texto}`);
  return achado as HTMLButtonElement;
}

function campoDoCodigo(): HTMLInputElement {
  const el = document.getElementById(
    "product-codigo-barras",
  ) as HTMLInputElement | null;
  if (!el) throw new Error("campo ausente: #product-codigo-barras");
  return el;
}

/** O `view` do App, reduzido: balcão, lista de produtos e formulário. */
function Roteador({
  formularioBaixado,
}: { readonly formularioBaixado: boolean }) {
  const [view, setView] = useState<View>("admin-pdv");
  const [baixou, setBaixou] = useState(formularioBaixado);
  useDescartarCodigoParaCadastro(view);
  const estado = {
    ...estadoInicialDaVenda(() => "chave-fixa"),
    aviso: { tipo: "nao_cadastrado" as const, codigo: "7891234567890" },
  };
  return (
    <div>
      <nav>
        <button type="button" onClick={() => setView("admin-products")}>
          Ir para Produtos
        </button>
        <button type="button" onClick={() => setBaixou(true)}>
          Formulário terminou de baixar
        </button>
      </nav>
      {view === "admin-pdv" && (
        <CupomDaVenda
          estado={estado}
          despachar={vi.fn()}
          subtotal={0}
          onNavigate={setView}
          feedback={null}
        />
      )}
      {view === "admin-products" && (
        <button type="button" onClick={() => setView("admin-product-form")}>
          Novo produto
        </button>
      )}
      {view === "admin-product-form" &&
        (baixou ? (
          <AdminProductFormView
            userId="u-teste"
            onNavigate={setView}
            onSetDirty={vi.fn()}
          />
        ) : (
          <p>Baixando o formulário…</p>
        ))}
    </div>
  );
}

describe("balcão — o código lido não vaza para outro cadastro", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar(formularioBaixado: boolean) {
    await act(async () => {
      raiz.render(<Roteador formularioBaixado={formularioBaixado} />);
    });
  }

  async function tocar(texto: string) {
    await act(async () => {
      botaoPorTexto(hospedeiro, texto).click();
      await esperarMicrotarefas();
    });
  }

  async function esperarOFormulario() {
    await act(async () => {
      await esperarMicrotarefas();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  it("controle: tocar em 'Cadastrar produto' e o formulário abrir direto preenche o campo", async () => {
    await montar(true);

    await tocar("Cadastrar produto");
    await esperarOFormulario();

    expect(campoDoCodigo().value).toBe("7891234567890");
  });

  it("tocar, sair para Produtos antes do formulário baixar e abrir OUTRO produto novo: campo vazio", async () => {
    await montar(false);

    await tocar("Cadastrar produto");
    expect(hospedeiro.textContent).toContain("Baixando o formulário");
    await tocar("Ir para Produtos");
    await tocar("Novo produto");
    await tocar("Formulário terminou de baixar");
    await esperarOFormulario();

    expect(campoDoCodigo().value).toBe("");
  });

  it("tocar e o formulário baixar só depois (sem sair): o campo ainda recebe o código", async () => {
    await montar(false);

    await tocar("Cadastrar produto");
    await tocar("Formulário terminou de baixar");
    await esperarOFormulario();

    expect(campoDoCodigo().value).toBe("7891234567890");
  });

  it("o App liga o hook ao view de verdade (o roteador acima só o imita)", () => {
    const app = readFileSync("src/App.tsx", "utf-8");

    expect(app).toContain("useDescartarCodigoParaCadastro(currentView);");
  });
});
