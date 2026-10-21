// @vitest-environment jsdom
import type { AdminUserDetailView as TipoTelaFicha } from "@/views/admin/AdminUserDetailView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

type Resultado = { data: unknown; error: { message: string } | null };
type ConsultaRemocao = Promise<Resultado> & {
  select: () => ConsultaRemocao;
  eq: (campo: string, id: string) => ConsultaRemocao;
  is: () => ConsultaRemocao;
};

function adiar() {
  let resolver!: (resultado: Resultado) => void;
  const promessa = new Promise<Resultado>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  produtos: vi.fn(),
  voz: vi.fn(),
  apagar: vi.fn(),
  filtro: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: mocks.rpc,
    from: (tabela: string) => ({
      select: () => ({
        in: (_campo: string, ids: string[]) => mocks.produtos(ids),
        eq: (_campo: string, id: string) => ({
          order: () => mocks.voz(tabela, id),
        }),
      }),
      delete: () => {
        const consulta: ConsultaRemocao = Object.assign(mocks.apagar(), {
          select: () => consulta,
          eq: (campo: string, id: string) => {
            mocks.filtro(campo, id);
            return consulta;
          },
          is: () => consulta,
        });
        return consulta;
      },
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function ficha(id: string): Resultado {
  return {
    data: {
      profile: {
        id,
        full_name: `Cliente ${id}`,
        role: "customer",
        created_at: "2026-02-07T00:00:00Z",
      },
      orders: [],
      addresses: [],
      cart_items: [{ product_id: `produto-${id}`, quantity: 1 }],
    },
    error: null,
  };
}

function produtos(id: string): Resultado {
  return {
    data: [{ id: `produto-${id}`, nome: `Produto ${id}`, preco_venda: 10 }],
    error: null,
  };
}

function voz(tabela: string, id: string): Resultado {
  const base = {
    id: `${tabela}-${id}`,
    product_id: `produto-${id}`,
    product: { nome: `Produto ${id}` },
    created_at: "2026-10-01T00:00:00Z",
  };
  return {
    data: [
      tabela === "reviews"
        ? { ...base, rating: 5, comment: `Avaliação ${id}` }
        : { ...base, question: `Pergunta ${id}`, answers: [] },
    ],
    error: null,
  };
}

describe("ficha do cliente — respostas pertencem ao usuário atual", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let TelaFicha: typeof TipoTelaFicha;
  let consultaA: ReturnType<typeof adiar>;
  let consultaB: ReturnType<typeof adiar>;
  const onBack = vi.fn();
  const onNavigate = vi.fn();

  beforeAll(async () => {
    ({ AdminUserDetailView: TelaFicha } = await import(
      "@/views/admin/AdminUserDetailView"
    ));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    consultaA = adiar();
    consultaB = adiar();
    mocks.rpc.mockImplementation((_nome, { p_user_id }) =>
      p_user_id === "A" ? consultaA.promessa : consultaB.promessa,
    );
    mocks.produtos.mockImplementation((ids: string[]) =>
      Promise.resolve(produtos(ids[0].replace("produto-", ""))),
    );
    mocks.voz.mockResolvedValue({ data: [], error: null });
    mocks.apagar.mockImplementation(() =>
      Promise.resolve({ data: [{ id: "linha-removida" }], error: null }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  const texto = () => hospedeiro.textContent ?? "";

  async function renderizar(id: string) {
    await act(async () => {
      raiz.render(
        <TelaFicha userId={id} onBack={onBack} onNavigate={onNavigate} />,
      );
    });
  }

  async function resolver(
    consulta: ReturnType<typeof adiar>,
    resultado: Resultado,
  ) {
    await act(async () => consulta.resolver(resultado));
  }

  async function abrirAba(nome: string) {
    const aba = [...hospedeiro.querySelectorAll('[role="tab"]')].find((item) =>
      item.textContent?.includes(nome),
    );
    expect(aba, `aba ${nome} disponível`).toBeDefined();
    await act(async () => {
      aba?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
  }

  function botaoLimpar(escopo: ParentNode = hospedeiro) {
    const botao = [...escopo.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === "Limpar Carrinho",
    );
    if (!botao) throw new Error("Botão Limpar Carrinho ausente");
    return botao;
  }

  async function confirmarLimpeza() {
    await act(async () => botaoLimpar().click());
    const dialogo = document.querySelector('[role="alertdialog"]');
    expect(dialogo).not.toBeNull();
    await act(async () => botaoLimpar(dialogo!).click());
  }

  async function responderBantesDeA() {
    await renderizar("A");
    await renderizar("B");
    await resolver(consultaB, ficha("B"));
    await resolver(consultaA, ficha("A"));
    await abrirAba("Carrinho");
  }

  it("ignora perfil e carrinho de A quando B respondeu primeiro", async () => {
    await responderBantesDeA();

    expect(texto()).toContain("Cliente B");
    expect(texto()).toContain("Produto B");
    expect(texto()).not.toContain("Cliente A");
    expect(texto()).not.toContain("Produto A");
  });

  it("limpa somente o carrinho do cliente que está exibido", async () => {
    await responderBantesDeA();
    const idExibido = texto().includes("Cliente A") ? "A" : "B";
    expect(texto()).toContain(`Cliente ${idExibido}`);

    await confirmarLimpeza();

    expect(mocks.filtro).toHaveBeenCalledWith("user_id", idExibido);
    expect(mocks.filtro).toHaveBeenCalledTimes(1);
  });

  it("esconde os dados de A e fecha sua confirmação enquanto B carrega", async () => {
    await renderizar("A");
    await resolver(consultaA, ficha("A"));
    await abrirAba("Carrinho");
    await act(async () => botaoLimpar().click());
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();

    await renderizar("B");

    expect(texto()).not.toContain("Cliente A");
    expect(texto()).not.toContain("Produto A");
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(mocks.apagar).not.toHaveBeenCalled();
    expect(
      [...hospedeiro.querySelectorAll("button")].some(
        (item) =>
          item.textContent?.trim() === "Limpar Carrinho" && !item.disabled,
      ),
    ).toBe(false);
  });

  it("não encerra o carregamento de B quando a consulta de A termina", async () => {
    await renderizar("A");
    await renderizar("B");
    await resolver(consultaA, ficha("A"));

    expect(texto()).not.toContain("Cliente A");
    expect(texto()).not.toContain("Usuário Não-Nomeado");
    expect(hospedeiro.querySelector('[role="tab"]')).toBeNull();

    await resolver(consultaB, ficha("B"));
    expect(texto()).toContain("Cliente B");
  });

  it("ignora produtos de A que terminam depois de carregar B", async () => {
    const produtosA = adiar();
    mocks.produtos.mockImplementation((ids: string[]) =>
      ids[0] === "produto-A"
        ? produtosA.promessa
        : Promise.resolve(produtos("B")),
    );
    await renderizar("A");
    await resolver(consultaA, ficha("A"));
    expect(mocks.produtos).toHaveBeenCalledWith(["produto-A"]);
    await renderizar("B");
    await resolver(consultaB, ficha("B"));
    await resolver(produtosA, produtos("A"));
    await abrirAba("Carrinho");

    expect(texto()).toContain("Cliente B");
    expect(texto()).toContain("Produto B");
    expect(texto()).not.toContain("Produto A");
  });

  it("falha tardia de A não troca a ficha válida de B por erro", async () => {
    await renderizar("A");
    await renderizar("B");
    await resolver(consultaB, ficha("B"));
    await resolver(consultaA, { data: null, error: { message: "Falha de A" } });

    expect(texto()).toContain("Cliente B");
    expect(texto()).not.toContain(
      "Não foi possível carregar os dados deste cliente",
    );
  });

  it("avaliações e perguntas tardias de A não substituem as de B", async () => {
    const reviewsA = adiar();
    const questionsA = adiar();
    mocks.voz.mockImplementation((tabela: string, id: string) =>
      id === "A"
        ? tabela === "reviews"
          ? reviewsA.promessa
          : questionsA.promessa
        : Promise.resolve(voz(tabela, id)),
    );
    await renderizar("A");
    await renderizar("B");
    await resolver(consultaB, ficha("B"));
    await resolver(reviewsA, voz("reviews", "A"));
    await resolver(questionsA, voz("questions", "A"));
    await abrirAba("Voz");

    expect(texto()).toContain("Avaliação B");
    expect(texto()).toContain("Pergunta B");
    expect(texto()).not.toContain("Avaliação A");
    expect(texto()).not.toContain("Pergunta A");
  });

  it("falha tardia da voz de A não apaga avaliações e perguntas de B", async () => {
    const vozA = adiar();
    mocks.voz.mockImplementation((tabela: string, id: string) =>
      id === "A" ? vozA.promessa : Promise.resolve(voz(tabela, id)),
    );
    await renderizar("A");
    await renderizar("B");
    await resolver(consultaB, ficha("B"));
    await resolver(vozA, {
      data: null,
      error: { message: "Falha da voz de A" },
    });
    await abrirAba("Voz");

    expect(texto()).toContain("Avaliação B");
    expect(texto()).toContain("Pergunta B");
    expect(texto()).not.toContain("Não conseguimos carregar");
  });

  it.each(["limpeza", "remoção"] as const)(
    "conclusão de %s de A não dispara outra consulta de A sobre B",
    async (acao) => {
      const limpezaA = adiar();
      mocks.apagar.mockReturnValue(limpezaA.promessa);
      await renderizar("A");
      await resolver(consultaA, ficha("A"));
      await abrirAba("Carrinho");
      if (acao === "limpeza") {
        await confirmarLimpeza();
      } else {
        const lixeira = hospedeiro.querySelector<HTMLButtonElement>(
          'button[title="Remover do Carrinho"]',
        );
        expect(lixeira).not.toBeNull();
        await act(async () => lixeira!.click());
        const confirmar = [
          ...document.querySelectorAll('[role="alertdialog"] button'),
        ].find((item) => item.textContent?.trim() === "Remover Item") as
          | HTMLButtonElement
          | undefined;
        expect(confirmar).toBeDefined();
        await act(async () => confirmar!.click());
      }
      expect(mocks.filtro).toHaveBeenCalledWith("user_id", "A");
      await renderizar("B");
      await resolver(consultaB, ficha("B"));
      await resolver(limpezaA, { data: [{ id: "linha-A" }], error: null });

      expect(mocks.rpc).toHaveBeenCalledTimes(2);
      expect(texto()).toContain("Cliente B");
      await abrirAba("Carrinho");
      expect(texto()).toContain("Produto B");
    },
  );
});
