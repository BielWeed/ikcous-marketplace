// @vitest-environment jsdom
//
// 27/11/2026 — o Pix que ficou para trás quando o iPhone fechou o app.
//
// A cliente usa a loja instalada (PWA). Finaliza no Pix (o carrinho é
// esvaziado na criação do pedido), vai ao app do banco e o iPhone fecha o app
// da loja. Ao reabrir, o app abre no Início, não no checkout — e o App apaga
// de propósito o "pedido pendente" guardado na aba (a página não carregou no
// checkout). Ela via o Início com o carrinho vazio e NADA dizia que havia um
// pedido esperando pagamento: refazia o pedido (duplicado) ou, se já tinha
// pago, comprava de novo.
//
// Agora a cliente LOGADA vê, no Início e no carrinho vazio, um aviso lido DO
// BANCO (nunca do armazenamento da aba): "Você tem um pedido aguardando
// pagamento — #XXXX · R$ Y" com "Ver e pagar" (leva ao detalhe do pedido, onde
// já existe "Retomar pagamento"). A regra é a MESMA do botão "Retomar
// pagamento" (`podeRetomarPagamento`) mais o prazo do Pix (`prazoDoPixPassou`).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { formatCurrency } from "@/lib/utils";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Linha = {
  id: string;
  total: number;
  status: string;
  payment_status: string | null;
  expires_at: string | null;
  created_at: string;
};

const h = vi.hoisted(() => ({
  usuario: null as null | { id: string },
  // Cada consulta chama esta função para saber o que o "banco" devolve.
  resposta: (() =>
    Promise.resolve({ data: [], error: null })) as () => Promise<{
    data: unknown;
    error: unknown;
  }>,
  consultas: [] as Array<{
    tabela: string;
    chamadas: Array<[string, unknown[]]>;
  }>,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      const registro = { tabela, chamadas: [] as Array<[string, unknown[]]> };
      h.consultas.push(registro);
      const consulta: Record<string, unknown> = {};
      const anotar =
        (metodo: string) =>
        (...args: unknown[]) => {
          registro.chamadas.push([metodo, args]);
          return consulta;
        };
      Object.assign(consulta, {
        select: anotar("select"),
        eq: anotar("eq"),
        in: anotar("in"),
        order: anotar("order"),
        limit: anotar("limit"),
        abortSignal: anotar("abortSignal"),
      });
      // biome-ignore lint/suspicious/noThenProperty: o construtor do supabase é "thenable".
      consulta.then = (
        aoResolver: (valor: unknown) => unknown,
        aoFalhar: (erro: unknown) => unknown,
      ) => h.resposta().then(aoResolver, aoFalhar);
      return consulta;
    },
  },
}));

const ID_A = "11111111-2222-3333-4444-5555550abc12";
const ID_B = "11111111-2222-3333-4444-5555550def34";

function linha(parcial: Partial<Linha> = {}): Linha {
  return {
    id: ID_A,
    total: 129.9,
    status: "pending",
    payment_status: "aguardando",
    expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
    created_at: new Date().toISOString(),
    ...parcial,
  };
}

function bancoDevolve(linhas: Linha[]) {
  h.resposta = () => Promise.resolve({ data: linhas, error: null });
}

async function esperar() {
  // A carga sob demanda (React.lazy) e a consulta resolvem em microtarefas.
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("Início avisa do pedido aguardando pagamento", () => {
  let raiz: Root;
  let alvo: HTMLDivElement;
  let navegar: Mock<(view: string, id?: string) => void>;

  beforeEach(() => {
    h.usuario = { id: "conta-1" };
    h.consultas.length = 0;
    bancoDevolve([]);
    navegar = vi.fn<(view: string, id?: string) => void>();
    alvo = document.createElement("div");
    document.body.append(alvo);
    raiz = createRoot(alvo);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    alvo.remove();
    vi.useRealTimers();
  });

  async function montarAviso(ativo = true) {
    const { AvisoDePedidoAguardandoPagamento } = await import(
      "@/components/ui/custom/AvisoDePedidoAguardandoPagamento"
    );
    await act(async () => {
      raiz.render(
        <AvisoDePedidoAguardandoPagamento
          userId="conta-1"
          onNavigate={navegar}
          ativo={ativo}
        />,
      );
    });
    await esperar();
  }

  async function montarPortaDaConta() {
    const { AvisoDePedidoAguardandoPagamentoDaConta } = await import(
      "@/components/ui/custom/AvisoDePedidoAguardandoPagamentoDaConta"
    );
    await act(async () => {
      raiz.render(
        <AvisoDePedidoAguardandoPagamentoDaConta
          userId={h.usuario?.id}
          onNavigate={navegar}
        />,
      );
    });
    await esperar();
  }

  function botao(nome: RegExp): HTMLButtonElement | undefined {
    return [...alvo.querySelectorAll("button")].find((b) =>
      nome.test(b.textContent ?? ""),
    );
  }

  it("Pix pendente no prazo: mostra número e valor, e 'Ver e pagar' leva ao pedido", async () => {
    bancoDevolve([linha()]);
    await montarAviso();

    expect(alvo.textContent).toContain(
      "Você tem um pedido aguardando pagamento",
    );
    expect(alvo.textContent).toContain("#0ABC12");
    expect(alvo.textContent).toContain(formatCurrency(129.9));
    // Quem já pagou não paga de novo: o aviso diz isso.
    expect(alvo.textContent).toMatch(/já pagou, não pague de novo/);

    const verEPagar = botao(/Ver e pagar/);
    expect(verEPagar).toBeDefined();
    act(() => {
      verEPagar?.click();
    });
    expect(navegar).toHaveBeenCalledWith("order-details", ID_A);
    // Um pedido só: nada de "ver todos".
    expect(botao(/Ver todos/)).toBeUndefined();
  });

  it("lê do banco só os pedidos pendentes DESTA conta", async () => {
    bancoDevolve([linha()]);
    await montarAviso();

    const consulta = h.consultas.find((c) => c.tabela === "marketplace_orders");
    expect(consulta).toBeDefined();
    const eqs = consulta?.chamadas
      .filter(([m]) => m === "eq")
      .map(([, args]) => args);
    expect(eqs).toContainEqual(["user_id", "conta-1"]);
    expect(eqs).toContainEqual(["status", "pending"]);
  });

  it.each([
    ["pago", { payment_status: "pago" }],
    ["cancelado", { status: "cancelled", payment_status: "aguardando" }],
    ["vencido pelo banco", { payment_status: "expirado" }],
    [
      "vencido pelo horário (o banco ainda não virou)",
      { expires_at: new Date(Date.now() - 60_000).toISOString() },
    ],
    ["pagamento na entrega", { payment_status: null }],
  ])("%s: sem aviso", async (_nome, parcial) => {
    bancoDevolve([linha(parcial as Partial<Linha>)]);
    await montarAviso();

    expect(alvo.textContent).not.toContain("aguardando pagamento");
    expect(botao(/Ver e pagar/)).toBeUndefined();
  });

  it("cartão recusado com o pedido ainda pendente: avisa (a mesma regra do Retomar pagamento)", async () => {
    bancoDevolve([linha({ payment_status: "recusado" })]);
    await montarAviso();

    expect(alvo.textContent).toContain(
      "Você tem um pedido aguardando pagamento",
    );
  });

  it("dois pedidos aguardando: mostra só o mais recente e oferece 'ver todos'", async () => {
    bancoDevolve([
      linha({ id: ID_B, total: 50, created_at: new Date().toISOString() }),
      linha({
        id: ID_A,
        total: 129.9,
        created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      }),
    ]);
    await montarAviso();

    expect(alvo.textContent).toContain("#0DEF34");
    expect(alvo.textContent).not.toContain("#0ABC12");
    const verTodos = botao(/Ver todos/);
    expect(verTodos).toBeDefined();
    act(() => {
      verTodos?.click();
    });
    expect(navegar).toHaveBeenCalledWith("orders");
  });

  it("erro de rede: sem aviso e sem quebrar a tela", async () => {
    h.resposta = () => Promise.reject(new TypeError("Failed to fetch"));
    await montarAviso();
    expect(alvo.textContent).not.toContain("aguardando pagamento");

    h.resposta = () =>
      Promise.resolve({ data: null, error: { message: "erro do banco" } });
    await act(async () => {
      raiz.unmount();
    });
    raiz = createRoot(alvo);
    await montarAviso();
    expect(alvo.textContent).not.toContain("aguardando pagamento");
  });

  it("voltar à aba depois de pagar: relê o banco e o aviso some", async () => {
    bancoDevolve([linha()]);
    await montarAviso();
    expect(alvo.textContent).toContain("aguardando pagamento");

    bancoDevolve([linha({ payment_status: "pago", status: "processing" })]);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await esperar();

    expect(alvo.textContent).not.toContain("aguardando pagamento");
  });

  it("o prazo do Pix passa com a tela aberta: o aviso some sozinho", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    bancoDevolve([
      linha({ expires_at: new Date(Date.now() + 60_000).toISOString() }),
    ]);
    await montarAviso();
    expect(alvo.textContent).toContain("aguardando pagamento");

    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });
    expect(alvo.textContent).not.toContain("aguardando pagamento");
  });

  it("fora de vista (ativo = false): não consulta o banco", async () => {
    bancoDevolve([linha()]);
    await montarAviso(false);
    expect(h.consultas).toHaveLength(0);
    expect(alvo.textContent).not.toContain("aguardando pagamento");
  });

  it("visitante (sem conta): nenhuma consulta e nenhum aviso", async () => {
    h.usuario = null;
    bancoDevolve([linha()]);
    await montarPortaDaConta();
    expect(h.consultas).toHaveLength(0);
    expect(alvo.textContent).toBe("");
  });

  it("cliente logada pela porta da conta: carrega o aviso sob demanda e mostra", async () => {
    bancoDevolve([linha()]);
    await montarPortaDaConta();
    expect(alvo.textContent).toContain(
      "Você tem um pedido aguardando pagamento",
    );
  });
});
