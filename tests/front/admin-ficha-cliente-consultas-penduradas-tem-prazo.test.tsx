// @vitest-environment jsdom
//
// Ficha do cliente no painel, rede que conecta e não responde:
// - aba "Voz do Cliente": as duas leituras (avaliações e perguntas) esperavam
//   sem prazo e os esqueletos giravam para sempre, sem erro nem "Tentar
//   novamente";
// - aba Carrinho: "Remover item" e "Limpar carrinho" são GRAVAÇÕES sem prazo —
//   o diálogo fecha ao toque, mas o carrinho ficava na tela, sem aviso nem
//   releitura, até a resposta chegar (que nunca chegava). Estourou o prazo, o servidor PODE ter apagado: a
//   tela avisa que não houve resposta, nunca diz que deu certo nem que falhou, e
//   relê a ficha para mostrar o estado real.
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

import type { AdminUserDetailView as TipoTelaFicha } from "@/views/admin/AdminUserDetailView";

/** A consulta dublada do Supabase: uma promessa que também encadeia filtros. */
interface ConsultaDublada extends Promise<unknown> {
  select: () => ConsultaDublada;
  eq: () => ConsultaDublada;
  is: () => ConsultaDublada;
}

const h = vi.hoisted(() => ({
  linhas: [] as {
    id: string;
    user_id: string;
    product_id: string;
    quantity: number;
    variant_id: string | null;
  }[],
  vozPendurada: false,
  exclusaoPendurada: false,
  leiturasDaFicha: 0,
  toasts: { sucesso: [] as string[], erro: [] as string[] },
}));

const produto = {
  id: "produto-1",
  nome: "Camiseta de prova",
  preco_venda: 10,
  estoque: 12,
  ativo: true,
  imagens: [],
  product_variants: [],
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "admin-1" } }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => {
      h.leiturasDaFicha++;
      return Promise.resolve({
        data: {
          profile: {
            id: "cliente-1",
            full_name: "Cliente de Prova",
            role: "customer",
            created_at: "2026-02-07T00:00:00Z",
            email: "cliente@example.test",
            whatsapp: "",
          },
          orders: [],
          cart_items: h.linhas.map((linha) => ({ ...linha })),
          addresses: [],
        },
        error: null,
      });
    },
    from: (tabela: string) => {
      if (tabela === "cart_items") {
        return {
          delete: () => {
            // O servidor apagou, mas a resposta nunca chega à tela.
            if (h.exclusaoPendurada) h.linhas = [];
            const consulta: ConsultaDublada = Object.assign(
              h.exclusaoPendurada
                ? new Promise(() => undefined)
                : Promise.resolve({ data: [{ id: "x" }], error: null }),
              {
                select: () => consulta,
                eq: () => consulta,
                is: () => consulta,
              },
            );
            return consulta;
          },
        };
      }
      if (tabela === "reviews" || tabela === "questions") {
        return {
          select: () => ({
            eq: () => ({
              order: () =>
                h.vozPendurada
                  ? new Promise(() => undefined)
                  : Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      }
      if (tabela !== "vw_produtos_admin") {
        throw new Error(`Tabela inesperada: ${tabela}`);
      }
      return {
        select: () => ({
          in: () => Promise.resolve({ data: [produto], error: null }),
        }),
      };
    },
  },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: {
    success: (mensagem: string) => h.toasts.sucesso.push(mensagem),
    error: (mensagem: string) => h.toasts.erro.push(mensagem),
    info: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("Ficha do cliente — consulta e gravação penduradas têm prazo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let TelaFicha: typeof TipoTelaFicha;

  beforeAll(async () => {
    ({ AdminUserDetailView: TelaFicha } = await import(
      "@/views/admin/AdminUserDetailView"
    ));
  });

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.vozPendurada = false;
    h.exclusaoPendurada = false;
    h.leiturasDaFicha = 0;
    h.toasts = { sucesso: [], erro: [] };
    h.linhas = [
      {
        id: "linha-1",
        user_id: "cliente-1",
        product_id: "produto-1",
        quantity: 1,
        variant_id: null,
      },
    ];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function abrirFicha() {
    await act(async () => {
      raiz.render(
        <TelaFicha userId="cliente-1" onBack={vi.fn()} onNavigate={vi.fn()} />,
      );
    });
    await passar(50);
  }

  async function abrirAba(nome: string) {
    const aba = [...hospedeiro.querySelectorAll('[role="tab"]')].find((item) =>
      item.textContent?.includes(nome),
    );
    if (!aba) throw new Error(`Aba ${nome} não encontrada.`);
    await act(async () => {
      aba.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
  }

  const botaoPorTexto = (texto: string, escopo: ParentNode) =>
    [...escopo.querySelectorAll("button")].find(
      (botao) => botao.textContent?.trim() === texto,
    );

  it("Voz do Cliente pendurada sai dos esqueletos, mostra o erro e permite tentar novamente", async () => {
    h.vozPendurada = true;
    await abrirFicha();
    await abrirAba("Voz do Cliente");
    expect(botaoPorTexto("Tentar novamente", hospedeiro)).toBeUndefined();

    await passar(20_000);

    const tentar = botaoPorTexto("Tentar novamente", hospedeiro);
    expect(tentar).toBeDefined();
    expect(hospedeiro.textContent).toContain(
      "Não conseguimos carregar o que este cliente escreveu.",
    );

    h.vozPendurada = false;
    await act(async () => tentar?.click());
    await passar(50);
    expect(hospedeiro.textContent).toContain("Nada Escrito Ainda");
  });

  it("remover item sem resposta avisa sem afirmar nada, não prende o diálogo e relê o carrinho real", async () => {
    h.exclusaoPendurada = true;
    await abrirFicha();
    await abrirAba("Carrinho");
    const lixeira = hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Remover do Carrinho"]',
    );
    if (!lixeira) throw new Error("Lixeira do item não encontrada.");
    await act(async () => lixeira.click());
    const leiturasAntes = h.leiturasDaFicha;
    const confirmar = botaoPorTexto("Remover Item", document.body);
    if (!confirmar) throw new Error("Confirmação não encontrada.");
    await act(async () => confirmar.click());

    // Antes do prazo a tela não afirma nada.
    expect(h.toasts.erro).toEqual([]);
    expect(h.toasts.sucesso).toEqual([]);

    await passar(20_000);

    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(h.toasts.sucesso).toEqual([]);
    expect(h.toasts.erro).toHaveLength(1);
    expect(h.toasts.erro[0]).toMatch(/Sem resposta da rede/);
    expect(h.toasts.erro[0]).toMatch(/não dá para saber/i);
    // Releu a ficha e mostra o que o servidor de fato tem (carrinho vazio).
    expect(h.leiturasDaFicha).toBeGreaterThan(leiturasAntes);
    expect(
      hospedeiro.querySelectorAll('button[title="Remover do Carrinho"]'),
    ).toHaveLength(0);
  });

  it("limpar carrinho sem resposta avisa sem afirmar nada, não prende o diálogo e relê o carrinho real", async () => {
    h.exclusaoPendurada = true;
    await abrirFicha();
    await abrirAba("Carrinho");
    const abrir = botaoPorTexto("Limpar Carrinho", hospedeiro);
    if (!abrir) throw new Error("Botão Limpar Carrinho não encontrado.");
    await act(async () => abrir.click());
    const dialogo = document.querySelector('[role="alertdialog"]');
    expect(dialogo).not.toBeNull();
    const leiturasAntes = h.leiturasDaFicha;
    const confirmar = botaoPorTexto("Limpar Carrinho", dialogo as Element);
    if (!confirmar) throw new Error("Confirmação não encontrada.");
    await act(async () => confirmar.click());

    expect(h.toasts.erro).toEqual([]);
    expect(h.toasts.sucesso).toEqual([]);

    await passar(20_000);

    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(h.toasts.sucesso).toEqual([]);
    expect(h.toasts.erro).toHaveLength(1);
    expect(h.toasts.erro[0]).toMatch(/Sem resposta da rede/);
    expect(h.toasts.erro[0]).toMatch(/não dá para saber/i);
    expect(h.leiturasDaFicha).toBeGreaterThan(leiturasAntes);
    expect(hospedeiro.textContent).not.toContain("Camiseta de prova");
  });
});
