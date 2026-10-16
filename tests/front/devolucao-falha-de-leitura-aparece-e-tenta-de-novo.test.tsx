// @vitest-environment jsdom
import { Profiler, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as devolucaoCliente from "@/hooks/useDevolucaoCliente";
import { useDevolucaoDoPedidoCliente } from "@/hooks/useDevolucaoDoPedidoCliente";
import type { Order } from "@/types";

const {
  rpc,
  lerReembolsos,
  fetchUserOrders,
  updateOrderStatus,
  respostas,
  falhas,
} = vi.hoisted(() => ({
  rpc: vi.fn(),
  lerReembolsos: vi.fn(),
  fetchUserOrders: vi.fn(),
  updateOrderStatus: vi.fn(),
  respostas: new Map<string, unknown>(),
  falhas: new Set<string>(),
}));

const pedidoEntregue: Order = {
  id: "pedido-devolucao-teste",
  customer: { name: "Cliente de teste", whatsapp: "34999999999" },
  items: [],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "online",
  paymentStatus: "pago",
  status: "delivered",
  createdAt: "2026-10-15T10:00:00Z",
  updatedAt: "2026-10-15T11:00:00Z",
  cancelledAfterShipping: false,
};
let pedidoAtual = pedidoEntregue;
const usuario = { id: "usuario-teste" };

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoAtual],
    fetchUserOrders,
    updateOrderStatus,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, storeAddress: "Rua de Teste, 10" },
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
          order: () => lerReembolsos(),
        }),
      }),
    }),
  },
}));

const POLITICA = {
  prazo_arrependimento_dias: 7,
  prazo_troca_dias: 30,
  prazo_vicio_dias: 90,
  aceita_troca: true,
  aceita_vale: true,
  exige_fotos_vicio: true,
  metodos_locais: ["entrega_na_loja"],
  metodos_nacionais: ["envio_proprio"],
  reembolso_momento: "ao_receber",
  frete_troca_pago_por: "cliente",
  categorias_sem_troca: [],
  texto_politica: null,
  endereco_devolucao: null,
  updated_at: null,
};
const ELEGIBILIDADE = {
  pode: true,
  motivo_bloqueio: null,
  entregue_em: "2026-10-15T10:00:00Z",
  dias_desde_entrega: 1,
  modalidade: "local",
  metodos: ["entrega_na_loja"],
  prazos: {
    arrependimento_ate: "2026-10-22",
    troca_ate: "2026-11-14",
    vicio_ate: "2027-01-13",
  },
  janelas: { arrependimento: true, troca: true, vicio: true },
  itens: [],
  politica: POLITICA,
};
const DEVOLUCAO = {
  id: "devolucao-teste",
  protocolo: "DV-TESTE",
  order_id: pedidoEntregue.id,
  tipo: "arrependimento",
  motivo: "tamanho_pequeno",
  detalhe: null,
  resolucao_desejada: "troca",
  resolucao_final: null,
  modalidade: "local",
  metodo_retorno: "entrega_na_loja",
  status: "aprovada",
  valor_itens: 100,
  valor_frete_ida: 0,
  valor_reembolso: null,
  refund_id: null,
  reembolso_manual: false,
  fotos: [],
  codigo_rastreio: null,
  codigo_postagem: null,
  me_reverse_id: null,
  etiqueta_url: null,
  coleta_em: null,
  mensagem_loja: "Traga o produto para a troca.",
  observacao_inspecao: null,
  entregue_em: "2026-10-15T10:00:00Z",
  prazo_ate: "2026-10-22",
  politica: POLITICA,
  created_at: "2026-10-16T10:00:00Z",
  aprovada_em: "2026-10-16T11:00:00Z",
  itens: [],
  eventos: [],
  pedido: null,
};
const AVISO =
  "Não conseguimos carregar as informações de devolução deste pedido.";

type Resposta = { data: unknown; error: unknown };

function pendente() {
  let resolver!: (resposta: Resposta) => void;
  const promessa = new Promise<Resposta>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
let quadros: Array<{ pedido: string; aviso: string | null }>;

// O hook e o cartão são reais. O spy só permite observar a chamada de
// recarregar e provocar uma recarga sem sair da ficha já montada.
function ultimaLeitura() {
  const ultima = vi
    .mocked(devolucaoCliente.useDevolucaoCliente)
    .mock.results.at(-1);
  if (ultima?.type !== "return") {
    throw new Error("O hook de devolução ainda não retornou.");
  }
  return ultima.value;
}

async function renderizar() {
  const id = pedidoAtual.id;
  const { OrderDetailsView } = await import(
    "@/views/customer/OrderDetailsView"
  );
  await act(async () => {
    raiz.render(
      <Profiler
        id="ficha-do-pedido"
        onRender={() => {
          // O commit já alterou o DOM, mas a limpeza dos efeitos ainda não
          // rodou: registra também o quadro fugaz que o act acaba escondendo.
          quadros.push({ pedido: id, aviso: aviso()?.textContent ?? null });
        }}
      >
        <OrderDetailsView
          orderId={id}
          onBack={() => {}}
          onNavigate={() => {}}
        />
      </Profiler>,
    );
  });
}

const aviso = () => hospedeiro.querySelector('[role="alert"]');
const solicitar = () =>
  hospedeiro.querySelector('[data-testid="acao-solicitar-devolucao"]');
const cartao = () =>
  hospedeiro.querySelector('[data-testid="cartao-devolucao"]');

function tentarDeNovo() {
  const botao = [...hospedeiro.querySelectorAll("button")].find(
    (elemento) => elemento.textContent === "Tentar de novo",
  );
  expect(botao).toBeDefined();
  botao?.click();
}

beforeEach(() => {
  quadros = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(devolucaoCliente, "useDevolucaoCliente");
  pedidoAtual = pedidoEntregue;
  fetchUserOrders.mockReset();
  fetchUserOrders.mockImplementation(async () => [pedidoAtual]);
  updateOrderStatus.mockReset();
  rpc.mockReset();
  lerReembolsos.mockReset();
  lerReembolsos.mockResolvedValue({ data: [], error: null });
  falhas.clear();
  respostas.clear();
  respostas.set("devolucao_elegibilidade", ELEGIBILIDADE);
  respostas.set("devolucoes_do_pedido", []);
  rpc.mockImplementation((nome: string) =>
    Promise.resolve(
      falhas.has(nome)
        ? { data: null, error: { message: "Falha simulada de rede" } }
        : { data: respostas.get(nome) ?? null, error: null },
    ),
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("falha ao ler a devolução na ficha do pedido", () => {
  it.each(["RPC", "resposta inválida", "detalhe", "exceção"])(
    "erro de A por %s não aparece em nenhum quadro de B antes da leitura",
    async (falha) => {
      if (falha === "RPC") {
        falhas.add("devolucao_elegibilidade");
      } else if (falha === "resposta inválida") {
        respostas.set("devolucao_elegibilidade", null);
      } else if (falha === "detalhe") {
        respostas.set("devolucoes_do_pedido", [DEVOLUCAO]);
      } else {
        rpc.mockRejectedValue(new Error("Falha simulada de rede"));
      }
      await renderizar();
      expect(ultimaLeitura().erro).toBe(true);
      expect(aviso()?.textContent).toContain(AVISO);

      const leituraDeB = pendente();
      rpc.mockImplementation((nome: string) =>
        nome === "devolucao_elegibilidade"
          ? leituraDeB.promessa
          : Promise.resolve({ data: [], error: null }),
      );
      const hook = vi.mocked(devolucaoCliente.useDevolucaoCliente);
      const inicio = hook.mock.results.length;
      pedidoAtual = { ...pedidoEntregue, id: "pedido-b" };

      await renderizar();

      const quadrosDeB = quadros.filter(
        (quadro) => quadro.pedido === "pedido-b",
      );
      expect(quadrosDeB.length).toBeGreaterThan(0);
      expect(quadrosDeB.every((quadro) => quadro.aviso === null)).toBe(true);
      // O spy guarda TODAS as devoluções do hook, inclusive o primeiro
      // render com carregando=false, antes do efeito iniciar a leitura de B.
      const leiturasDeB = hook.mock.results
        .slice(inicio)
        .flatMap((resultado, i) =>
          hook.mock.calls[inicio + i]?.[0] === "pedido-b" &&
          resultado.type === "return"
            ? [resultado.value]
            : [],
        );
      expect(leiturasDeB.length).toBeGreaterThan(0);
      expect(leiturasDeB.every((leitura) => leitura.erro === false)).toBe(true);
      expect(ultimaLeitura().carregando).toBe(true);
      expect(aviso()).toBeNull();

      await act(async () =>
        leituraDeB.resolver({
          data: null,
          error: { message: "Falha real de B" },
        }),
      );
      expect(ultimaLeitura().erro).toBe(true);
      expect(aviso()?.textContent).toContain(AVISO);

      rpc.mockImplementation((nome: string) =>
        Promise.resolve({
          data: nome === "devolucao_elegibilidade" ? ELEGIBILIDADE : [],
          error: null,
        }),
      );
      await act(async () => tentarDeNovo());

      expect(ultimaLeitura().erro).toBe(false);
      expect(aviso()).toBeNull();
      expect(solicitar()).not.toBeNull();
      expect(rpc).toHaveBeenLastCalledWith("devolucoes_do_pedido", {
        p_order_id: "pedido-b",
      });
    },
  );

  it.each(["devolucao_elegibilidade", "devolucoes_do_pedido"])(
    "falha em %s mostra aviso e permite tentar de novo com sucesso",
    async (consulta) => {
      falhas.add(consulta);
      await renderizar();

      expect(aviso()?.textContent).toContain(AVISO);
      expect(aviso()?.textContent).toContain("Tentar de novo");
      expect(solicitar()).toBeNull();
      const recarregar = vi.spyOn(ultimaLeitura(), "recarregar");
      falhas.clear();

      await act(async () => tentarDeNovo());

      expect(recarregar).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith("devolucao_elegibilidade", {
        p_order_id: pedidoEntregue.id,
      });
      expect(aviso()).toBeNull();
      expect(solicitar()?.textContent).toContain(
        "Solicitar devolução ou troca",
      );
    },
  );

  it("esconde o erro anterior enquanto a nova tentativa está carregando", async () => {
    falhas.add("devolucao_elegibilidade");
    await renderizar();
    expect(aviso()?.textContent).toContain(AVISO);
    const novaLeitura = pendente();
    rpc.mockImplementation((nome: string) =>
      nome === "devolucao_elegibilidade"
        ? novaLeitura.promessa
        : Promise.resolve({ data: [], error: null }),
    );

    await act(async () => tentarDeNovo());

    expect(ultimaLeitura().carregando).toBe(true);
    expect(ultimaLeitura().erro).toBe(true);
    expect(aviso()).toBeNull();
    await act(async () =>
      novaLeitura.resolver({ data: ELEGIBILIDADE, error: null }),
    );
    expect(aviso()).toBeNull();
    expect(solicitar()).not.toBeNull();
  });

  it("leitura bem-sucedida oferece a solicitação sem aviso", async () => {
    await renderizar();

    expect(solicitar()).not.toBeNull();
    expect(aviso()).toBeNull();
    expect(hospedeiro.textContent).not.toContain(AVISO);
  });

  it("preserva a devolução carregada durante a recarga e depois da falha", async () => {
    respostas.set("devolucao_elegibilidade", {
      ...ELEGIBILIDADE,
      pode: false,
      motivo_bloqueio: "Já existe uma devolução em andamento para este pedido.",
    });
    respostas.set("devolucoes_do_pedido", [DEVOLUCAO]);
    respostas.set("devolucao_detalhe", DEVOLUCAO);
    await renderizar();
    expect(cartao()?.textContent).toContain("DV-TESTE");
    const novaLeitura = pendente();
    rpc.mockImplementation(() => novaLeitura.promessa);

    await act(async () => {
      void ultimaLeitura().recarregar();
    });

    expect(ultimaLeitura().carregando).toBe(true);
    expect(cartao()?.textContent).toContain("DV-TESTE");
    expect(aviso()).toBeNull();
    await act(async () =>
      novaLeitura.resolver({
        data: null,
        error: { message: "Falha simulada" },
      }),
    );
    expect(ultimaLeitura().erro).toBe(true);
    expect(cartao()?.textContent).toContain("DV-TESTE");
    expect(cartao()?.textContent).toContain("Traga o produto para a troca.");
    expect(aviso()?.textContent).toContain(AVISO);
    expect(aviso()?.textContent).toContain("Tentar de novo");
  });

  it("pedido não entregue não consulta devolução nem mostra aviso", async () => {
    pedidoAtual = { ...pedidoEntregue, status: "shipping" };
    falhas.add("devolucao_elegibilidade");
    falhas.add("devolucoes_do_pedido");

    await renderizar();

    expect(hospedeiro.textContent).toContain("Chegando até você");
    expect(rpc).not.toHaveBeenCalled();
    expect(aviso()).toBeNull();
    expect(solicitar()).toBeNull();
  });
});

describe("erro da devolução de dinheiro pertence ao pedido lido", () => {
  it.each(["RPC", "exceção"])(
    "falha de A por %s não vaza em nenhum render de B e a nova tentativa funciona",
    async (falha) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      if (falha === "RPC") {
        lerReembolsos.mockResolvedValue({
          data: null,
          error: { message: "rede" },
        });
      } else {
        lerReembolsos.mockRejectedValue(new Error("rede"));
      }
      const leituras: Array<ReturnType<typeof useDevolucaoDoPedidoCliente>> =
        [];
      function Sonda({ id }: { id: string }) {
        const leitura = useDevolucaoDoPedidoCliente(id, true);
        leituras.push(leitura);
        return null;
      }
      await act(async () => raiz.render(<Sonda id="pedido-a" />));
      expect(leituras.at(-1)?.erro).toBe(true);
      const leituraDeB = pendente();
      lerReembolsos.mockReturnValue(leituraDeB.promessa);
      const inicio = leituras.length;

      await act(async () => raiz.render(<Sonda id="pedido-b" />));

      expect(leituras.length).toBeGreaterThan(inicio);
      expect(leituras.slice(inicio).every((leitura) => !leitura.erro)).toBe(
        true,
      );
      expect(leituras.at(-1)?.carregando).toBe(true);
      await act(async () =>
        leituraDeB.resolver({
          data: null,
          error: { message: "Falha real de B" },
        }),
      );
      expect(leituras.at(-1)?.erro).toBe(true);

      lerReembolsos.mockResolvedValue({ data: [], error: null });
      await act(async () => vi.advanceTimersByTimeAsync(4_000));

      expect(leituras.at(-1)?.erro).toBe(false);
      expect(leituras.at(-1)?.lido).toBe(true);
    },
  );
});

describe("desistência da devolução de dinheiro pertence ao pedido lido", () => {
  it("pedido A que desistiu não faz B aparecer como desistido em nenhum render", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    lerReembolsos.mockResolvedValue({
      data: null,
      error: { message: "rede" },
    });
    const leituras: Array<ReturnType<typeof useDevolucaoDoPedidoCliente>> = [];
    function Sonda({ id }: { id: string }) {
      const leitura = useDevolucaoDoPedidoCliente(id, true);
      leituras.push(leitura);
      return null;
    }
    await act(async () => raiz.render(<Sonda id="pedido-a" />));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(leituras.at(-1)?.desistiu).toBe(true);
    const leituraDeB = pendente();
    lerReembolsos.mockReturnValue(leituraDeB.promessa);
    const inicio = leituras.length;

    await act(async () => raiz.render(<Sonda id="pedido-b" />));

    expect(leituras.length).toBeGreaterThan(inicio);
    expect(leituras.slice(inicio).every((leitura) => !leitura.desistiu)).toBe(
      true,
    );
    expect(leituras.at(-1)?.carregando).toBe(true);

    lerReembolsos.mockResolvedValue({
      data: null,
      error: { message: "rede" },
    });
    await act(async () =>
      leituraDeB.resolver({ data: null, error: { message: "rede" } }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(leituras.at(-1)?.desistiu).toBe(true);
  });
});
