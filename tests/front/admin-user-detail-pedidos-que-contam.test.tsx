import type { AdminUserDetailView as TipoTelaFicha } from "@/views/admin/AdminUserDetailView";
// @vitest-environment jsdom
//
// Auditoria de 20/08/2026, achado 5 — a lista de Clientes e a ficha do mesmo
// cliente discordavam sobre quantos pedidos ele tem.
//
// O QUE ESTAVA ERRADO
//   Na lista: "João Gabriel — Pedidos 6". Abrindo o mesmo cliente:
//   "Cesta / Pedidos 16". Dez de diferença, e nenhuma das duas telas
//   explicava a outra.
//
//   A lista conta pelo servidor, com `status NOT IN ('cancelled','returned')`.
//   A ficha contava `orders.length` — tudo que a RPC devolveu, cancelados
//   incluídos. Com 72 dos 83 pedidos deste banco cancelados, a divergência
//   aparece em quase todo cliente com histórico.
//
//   Havia um terceiro número no meio: o LTV da ficha filtrava só
//   `!== "cancelled"`, esquecendo `returned`. Ou seja, dentro da MESMA tela o
//   dinheiro e a contagem de pedidos falavam de conjuntos diferentes.
//
// A CORREÇÃO, E O QUE ELA NÃO FAZ
//   O card passa a contar os pedidos que valem, com a mesma regra do servidor,
//   e diz na própria tela quantos ficaram de fora. A ABA continua mostrando o
//   total do histórico, porque é isso que a tabela abaixo dela lista — trocar
//   aquele número por 6 faria a aba mentir sobre o próprio conteúdo.
//
//   Ou seja: os dois números continuam existindo, o que some é o mistério.
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

type PedidoFalso = {
  id: string;
  status: string;
  total: number;
  payment_status?: string | null;
};

const { estado } = vi.hoisted(() => ({
  estado: { orders: [] as PedidoFalso[] },
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
          orders: estado.orders.map((o) => ({
            ...o,
            created_at: "2026-08-01T00:00:00Z",
            items: [],
          })),
          cart_items: [],
          addresses: [],
        },
        error: null,
      }),
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: [], error: null }),
      }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
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

describe("AdminUserDetailView — a contagem de pedidos bate com a lista", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    // O caso real da auditoria: 16 pedidos no histórico, 10 cancelados,
    // 6 que contam — exatamente o que a lista de Clientes mostrava.
    estado.orders = [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `cancelado-${i}`,
        status: "cancelled",
        total: 50,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `valido-${i}`,
        status: "delivered",
        total: 20,
      })),
      { id: "pendente", status: "pending", total: 17 },
    ];
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

  // O `await import()` da tela custa ~3,5 s (ela puxa o componente inteiro e
  // a árvore de dependências dele). Enquanto isso vivia DENTRO do primeiro
  // `it`, aquele caso media 3604 ms contra um `testTimeout` de 5000 ms —
  // margem de 1,4x, e a máquina decidia o resultado. Medido: 3 verdes e 5
  // vermelhas em 8 rodadas isoladas, e o estouro derrubava mais quatro casos
  // por cascata (DOM vazio), o que fazia parecer defeito de lógica.
  //
  // Carregar aqui move o custo para onde ele é: preparação, não asserção.
  // O `hookTimeout` é o dobro do `testTimeout`, e nenhum caso paga sozinho
  // uma conta que é de todos.
  // `import type` é apagado na compilação, então não dispara o carregamento
  // do módulo — só empresta o tipo. (A anotação `typeof import("...")` em
  // linha NÃO serve aqui: o Biome a quebra em várias linhas com vírgula, o
  // que não é TypeScript válido, e o arquivo para de compilar.)
  let TelaFicha: typeof TipoTelaFicha;

  beforeAll(async () => {
    ({ AdminUserDetailView: TelaFicha } = await import(
      "@/views/admin/AdminUserDetailView"
    ));
  });

  async function abrirFicha() {
    const AdminUserDetailView = TelaFicha;
    await act(async () => {
      raiz.render(
        <AdminUserDetailView
          userId="cliente-1"
          onBack={vi.fn()}
          onNavigate={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await esperar(50);
    });
  }

  const texto = () => (hospedeiro.textContent ?? "").replace(/\s+/g, " ");

  /**
   * O número do card, extraído EXATO.
   *
   * A primeira versão deste helper procurava um `div` que contivesse
   * "Pedidos" e fazia `toContain("6")` — e passava contra o código defeituoso,
   * porque "16" contém "6". Teste decorativo. Agora localiza o rótulo pelo
   * texto exato, sobe para o cartão e devolve o primeiro número inteiro,
   * comparado por igualdade.
   */
  function numeroDoCard(rotulo: string): number {
    const etiqueta = [...hospedeiro.querySelectorAll("span")].find(
      (s) => s.textContent?.trim() === rotulo,
    );
    if (!etiqueta) throw new Error(`Card "${rotulo}" não está na tela.`);
    const cartao = etiqueta.parentElement?.parentElement;
    const numero = [...(cartao?.querySelectorAll("span") ?? [])]
      .map((s) => s.textContent?.trim() ?? "")
      .find((t) => /^\d+$/.test(t));
    if (numero === undefined) {
      throw new Error(
        `Card "${rotulo}" não tem número: ${cartao?.textContent}`,
      );
    }
    return Number(numero);
  }

  /**
   * O valor em reais do card, extraído EXATO — mesma ideia do `numeroDoCard`,
   * mas para "LTV Total".
   *
   * `toContain("R$ 40,00")` no texto inteiro da tela é decorativo: a tabela
   * "Extrato Histórico" imprime `formatCurrency(order.total)` por LINHA,
   * então o valor de um pedido aparece ali INDEPENDENTE de ele entrar no LTV
   * ou não — um teste que procurasse só isso passaria mesmo com o filtro de
   * pagamento inteiramente removido. Este helper sobe ao cartão do rótulo e
   * pega só o valor QUE ESTÁ NELE.
   */
  function valorDoCard(rotulo: string): string {
    const etiqueta = [...hospedeiro.querySelectorAll("span")].find(
      (s) => s.textContent?.trim() === rotulo,
    );
    if (!etiqueta) throw new Error(`Card "${rotulo}" não está na tela.`);
    const cartao = etiqueta.parentElement?.parentElement;
    // \s+ -> " ": o Intl.NumberFormat de moeda separa "R$" do número com um
    // espaço NÃO separável (U+00A0), invisível na comparação mas diferente
    // byte a byte de um espaço normal digitado no teste. `texto()`, acima,
    // já faz a mesma normalização — sem ela `toBe("R$ 100,00")` falharia
    // sempre, mesmo com o valor certo.
    const valor = [...(cartao?.querySelectorAll("span") ?? [])]
      .map((s) => (s.textContent ?? "").replace(/\s+/g, " ").trim())
      .find((t) => /^R\$/.test(t));
    if (valor === undefined) {
      throw new Error(`Card "${rotulo}" não tem valor: ${cartao?.textContent}`);
    }
    return valor;
  }

  it("o card conta os pedidos que valem, com a mesma regra da lista", async () => {
    await abrirFicha();

    // 16 no histórico, 10 cancelados: a lista de Clientes mostra 6 para este
    // cliente, e a ficha tem de mostrar o mesmo.
    expect(numeroDoCard("Cesta / Pedidos")).toBe(6);
  });

  it("diz na tela quantos ficaram de fora, para a diferenca nao ser misterio", async () => {
    await abrirFicha();

    // Sem esta linha, o card diria 6 e a aba 16 sem nada explicando.
    expect(texto()).toMatch(/10 fora da conta/i);
    // E NAO diz "cancelado": o numero conta cancelado E devolvido, entao esse
    // rotulo mentiria sobre um pedido devolvido.
    expect(texto()).not.toMatch(/10 cancelad/i);
  });

  it("a aba continua mostrando o historico inteiro, que e o que a tabela lista", async () => {
    await abrirFicha();

    expect(texto()).toContain("(16)");
  });

  it("um pedido devolvido tambem nao conta, igual ao servidor", async () => {
    // A lista usa `NOT IN ('cancelled','returned')`. A ficha filtrava só
    // 'cancelled' — com um devolvido, os dois números divergiam de novo.
    estado.orders = [
      { id: "a", status: "delivered", total: 10 },
      { id: "b", status: "returned", total: 90 },
    ];
    await abrirFicha();

    expect(numeroDoCard("Cesta / Pedidos")).toBe(1);
    // E o dinheiro do devolvido também sai do LTV.
    expect(texto()).toContain("R$ 10,00");
    expect(texto()).not.toContain("R$ 100,00");
  });

  it("cliente sem nenhum descarte nao ganha a linha de explicacao", async () => {
    // A linha só existe para explicar uma diferença. Sem diferença, ela seria
    // ruído — e "0 fora da conta" numa ficha limpa é pior que nada.
    //
    // A versao anterior deste teste procurava /cancelad\w+ nao cont/, que a
    // tela NUNCA imprimiu em cenario nenhum: ele passava com a guarda
    // `pedidosDescartados > 0` removida. Agora procura a frase real.
    estado.orders = [{ id: "a", status: "delivered", total: 10 }];
    await abrirFicha();

    expect(texto()).not.toMatch(/fora da conta/i);
  });

  // Achado 17 (auditoria de 20/08/2026): o LTV contava pedido que ninguém
  // pagou. A correção (migration 20260823000000, espelhada aqui) é SÓ sobre
  // dinheiro — a contagem de "Cesta / Pedidos" continua na mesma regra de
  // sempre (status), porque mudar a contagem reabriria o achado 5 acima:
  // a lista de Clientes conta pedido aguardando pagamento como "Pedidos", e
  // se a ficha parasse de contar o mesmo pedido os dois números voltariam a
  // discordar.
  it("pedido aguardando pagamento nao entra no LTV, mas continua contando como pedido", async () => {
    estado.orders = [
      { id: "pago", status: "delivered", total: 100, payment_status: "pago" },
      {
        id: "pendente",
        status: "pending",
        total: 30,
        payment_status: "aguardando",
      },
    ];
    await abrirFicha();

    // Os dois continuam "pedidos que contam" para a contagem — só o dinheiro
    // do pendente sai do LTV.
    expect(numeroDoCard("Cesta / Pedidos")).toBe(2);
    expect(valorDoCard("LTV Total")).toBe("R$ 100,00");
  });

  it("pedido com payment_status nulo entra no LTV, igual a pedido pago na entrega", async () => {
    // payment_status NULO significa "sem cobrança online" (pedido pago na
    // entrega, ou histórico) — CONTA por definição da regra, a mesma leitura
    // que o mapper já preserva (mappers.ts:244-246, `null` não é traduzido).
    estado.orders = [
      {
        id: "sem-cobranca",
        status: "delivered",
        total: 40,
        payment_status: null,
      },
    ];
    await abrirFicha();

    expect(numeroDoCard("Cesta / Pedidos")).toBe(1);
    expect(valorDoCard("LTV Total")).toBe("R$ 40,00");
  });
});
