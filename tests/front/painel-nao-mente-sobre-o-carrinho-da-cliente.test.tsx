import type { AdminUserDetailView as TipoTelaFicha } from "@/views/admin/AdminUserDetailView";
// @vitest-environment jsdom
//
// Dois defeitos na ficha do cliente, no painel do admin.
//
// DEFEITO 1 — "Item removido com sucesso!" e o item continua lá
//   A policy `cart_items_delete_policy` do schema vivo é
//   `USING (auth.uid() = user_id)` — sem `is_admin()` (diferente da de
//   SELECT, que tem `OR is_admin()` explícito). Quando a lojista apaga o
//   carrinho de outra pessoa, a policy descarta todas as linhas e o
//   PostgREST responde SUCESSO com ZERO linhas. Sem `.select()` na chamada,
//   `if (error) throw` nunca dispara e a tela comemora uma remoção que não
//   aconteceu.
//
// DEFEITO 2 — clicar num pedido da cliente leva a "Pedido não encontrado"
//   A linha do pedido navegava para `onNavigate("order-details", order.id)`,
//   que é a tela do CLIENTE — filtra por `user_id` do usuário logado (a
//   lojista) e nunca acha o pedido de outra pessoa. O destino certo é o
//   painel (`admin-orders`), que abre o pedido avulso por
//   `selectedOrderId`.
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

const { estado } = vi.hoisted(() => ({
  estado: {
    // Quantas linhas o `.delete().select("id")` do banco devolve. 0 == a
    // policy descartou tudo (RLS bloqueou); 1 == a policy deixou passar.
    linhasApagadas: 0 as number,
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "admin-1" } }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () =>
      Promise.resolve({
        data: {
          profile: {
            id: "cliente-1",
            full_name: "Cliente de Prova",
            role: "customer",
            created_at: "2026-02-07T00:00:00Z",
            email: "prova@exemplo.com",
            whatsapp: "34999999999",
          },
          orders: [
            {
              id: "pedido-123",
              status: "delivered",
              total: 40,
              created_at: "2026-08-01T00:00:00Z",
              items: [],
            },
          ],
          cart_items: [
            { product_id: "produto-1", quantity: 2, variant_id: null },
          ],
          addresses: [],
        },
        error: null,
      }),
    from: (tabela: string) => {
      if (tabela === "cart_items") {
        return {
          delete: () => {
            // O componente encadeia `.select("id")` e depois `.eq(...)` /
            // `.is(...)` (uma ou mais vezes) antes de dar `await`. O
            // `builder` é uma Promise DE VERDADE (resolve na hora, com o
            // resultado já calculado) com os métodos encadeáveis anexados —
            // biome proíbe definir `then` como propriedade solta de objeto
            // (`noThenProperty`), então a promessa real é o jeito limpo de
            // ficar "awaitable" sem esbarrar nessa regra.
            const builder: any = Promise.resolve({
              data:
                estado.linhasApagadas > 0
                  ? Array.from({ length: estado.linhasApagadas }, (_, i) => ({
                      id: `linha-${i}`,
                    }))
                  : [],
              error: null,
            });
            builder.select = () => builder;
            builder.eq = () => builder;
            builder.is = () => builder;
            return builder;
          },
        };
      }
      // Tabela usada para reidratar produto do carrinho (vw_produtos_admin).
      return {
        select: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
        }),
      };
    },
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AdminUserDetailView — o painel não mente sobre o carrinho nem o pedido da cliente", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estado.linhasApagadas = 0;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  // Mesma técnica do teste vizinho (admin-user-detail-pedidos-que-contam):
  // o `await import()` custa ~3,5s e não pode ser pago dentro do primeiro
  // `it`, sob pena de estourar o `testTimeout` por causa da carga da
  // máquina, não da lógica.
  let TelaFicha: typeof TipoTelaFicha;

  beforeAll(async () => {
    ({ AdminUserDetailView: TelaFicha } = await import(
      "@/views/admin/AdminUserDetailView"
    ));
  });

  const onNavigate = vi.fn();

  async function abrirFicha() {
    const AdminUserDetailView = TelaFicha;
    onNavigate.mockClear();
    await act(async () => {
      raiz.render(
        <AdminUserDetailView
          userId="cliente-1"
          onBack={vi.fn()}
          onNavigate={onNavigate}
        />,
      );
    });
    await act(async () => {
      await esperar(50);
    });
  }

  async function abrirAbaCarrinho() {
    const abasTab = [...hospedeiro.querySelectorAll('[role="tab"]')];
    const abaCarrinho = abasTab.find((b) =>
      b.textContent?.includes("Carrinho"),
    );
    if (!abaCarrinho)
      throw new Error(
        `Aba Carrinho não está na tela. Abas: ${abasTab.map((a) => a.textContent).join(" / ")}`,
      );
    // O Radix Tabs troca de aba no `mousedown` (não no `click`) — ver
    // node_modules/@radix-ui/react-tabs/dist/index.mjs, TabsTrigger.
    await act(async () => {
      abaCarrinho.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    });
    await act(async () => {
      await esperar(0);
    });
  }

  function clicarNaLixeiraDoItem() {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.getAttribute("title")?.includes("Remover do Carrinho"),
    );
    if (!botao) throw new Error("Botão de remover item não está na tela.");
    return act(async () => {
      botao.click();
    });
  }

  // "Limpar Carrinho" e o rotulo do botao da PAGINA e tambem do botao de
  // confirmar dentro do dialogo. Procurar por texto no documento inteiro
  // acharia sempre o primeiro (o da pagina) e o dialogo nunca seria
  // confirmado -- por isso os dois cliques sao explicitos, cada um no seu
  // lugar: o gatilho dentro do `hospedeiro`, a confirmacao no portal, que o
  // Radix monta FORA dele.
  async function limparCarrinhoConfirmando() {
    const gatilho = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Limpar Carrinho",
    );
    if (!gatilho) throw new Error("Botao Limpar Carrinho nao esta na tela.");
    await act(async () => {
      gatilho.click();
    });
    await act(async () => {
      await esperar(0);
    });

    const confirmar = [...document.body.querySelectorAll("button")]
      .filter((b) => b.textContent?.trim() === "Limpar Carrinho")
      .find((b) => !hospedeiro.contains(b));
    if (!confirmar) {
      throw new Error(
        "O dialogo de confirmacao nao abriu -- o caso nao montou.",
      );
    }
    await act(async () => {
      confirmar.click();
    });
    await act(async () => {
      await esperar(0);
    });
  }

  async function confirmarNoDialogo(rotuloBotao: string) {
    // O AlertDialog do Radix é portalado direto para `document.body`, fora
    // de `hospedeiro` — por isso a busca é no documento inteiro.
    const botao = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === rotuloBotao,
    );
    if (!botao) throw new Error(`Botão "${rotuloBotao}" não está na tela.`);
    await act(async () => {
      botao.click();
    });
    await act(async () => {
      await esperar(0);
    });
  }

  it("delete que apaga zero linhas mostra o aviso de FALHA, não de sucesso — a lojista não tem permissão sobre carrinho alheio", async () => {
    estado.linhasApagadas = 0;
    await abrirFicha();
    await abrirAbaCarrinho();

    await clicarNaLixeiraDoItem();
    await confirmarNoDialogo("Remover Item");

    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Nada foi removido"),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("controle negativo: delete que apaga uma linha mostra o sucesso normalmente", async () => {
    estado.linhasApagadas = 1;
    await abrirFicha();
    await abrirAbaCarrinho();

    await clicarNaLixeiraDoItem();
    await confirmarNoDialogo("Remover Item");

    const { toast } = await import("sonner");
    expect(toast.success).toHaveBeenCalledWith("Item removido com sucesso!");
    expect(toast.error).not.toHaveBeenCalled();
  });

  // O handler de LIMPAR CARRINHO nao tinha um unico teste, e a revisao mediu
  // duas mutacoes sobrevivendo aos tres casos originais. A pior:
  // `data.length === 0` virando `data.length !== 1` -- com dois itens o banco
  // apaga os dois, devolve 2, e a tela diz "nada foi removido" DEPOIS de ter
  // removido. E a mesma mentira do defeito, ao contrario. Por isso o caso de
  // sucesso aqui usa DUAS linhas: e o unico numero que distingue as duas.
  it("limpar carrinho que apaga zero linhas mostra o aviso de FALHA", async () => {
    estado.linhasApagadas = 0;
    await abrirFicha();
    await abrirAbaCarrinho();

    await limparCarrinhoConfirmando();

    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Nada foi removido"),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("controle negativo: limpar carrinho de DOIS itens mostra o sucesso", async () => {
    estado.linhasApagadas = 2;
    await abrirFicha();
    await abrirAbaCarrinho();

    await limparCarrinhoConfirmando();

    const { toast } = await import("sonner");
    expect(toast.success).toHaveBeenCalledWith("Carrinho limpo com sucesso!");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("clicar num pedido navega para o painel (admin-orders), não para a tela do cliente (order-details)", async () => {
    await abrirFicha();

    const linhaDoPedido = [...hospedeiro.querySelectorAll("tr")].find((tr) =>
      tr.textContent?.includes("PEDIDO-1"),
    );
    if (!linhaDoPedido) throw new Error("Linha do pedido não está na tela.");

    await act(async () => {
      (linhaDoPedido as HTMLElement).click();
    });

    expect(onNavigate).toHaveBeenCalledWith("admin-orders", "pedido-123");
    expect(onNavigate).not.toHaveBeenCalledWith("order-details", "pedido-123");
  });
});
