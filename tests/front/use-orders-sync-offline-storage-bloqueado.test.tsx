import { setImmediate as proximoCicloReal } from "node:timers/promises";
// @vitest-environment jsdom
//
// A sincronização da fila offline de pedidos (useOrders, efeito "online")
// lia `localStorage` FORA do try: navegador com armazenamento bloqueado
// (SecurityError) fazia a promessa REJEITAR, e o único chamador não tinha
// `.catch` — rejeição solta no console (e, na suíte, EXIT 1). A ESCRITA da
// fila no fim da passada (setItem/removeItem) caía no catch geral DEPOIS das
// RPCs: o toast de "Sincronizando..." ficava preso para sempre.
//
// Contrato provado aqui, para os TRÊS pontos de storage (leitura, setItem,
// removeItem):
//   1. storage indisponível = a sincronização NÃO concluiu: nada de sucesso,
//      nada de recarga pós-sync, nenhum toast de carregamento preso;
//   2. a fila no storage fica intacta (nada é apagado nem reescrito);
//   3. quando o storage volta, o PRÓXIMO gatilho que já existe (evento
//      "online") processa a fila normalmente — o que também prova que a
//      trava `sincronizacaoEmVoo` foi solta depois da falha.
//
// Mesmo harness dos vizinhos use-orders-sync-offline-*: hook REAL, sonda
// administrativa (a recarga pós-sync é observável pela RPC
// `get_admin_orders_paged`); este projeto não tem @testing-library/react.
//
// Rejeição não tratada: capturada com `process.on("unhandledRejection")`
// (o jsdom roda dentro do Node do vitest; é o mesmo evento que o vitest usa
// para reprovar a suíte). O evento só dispara depois que a fila de
// microtarefas esvazia, por isso o teste espera um ciclo REAL de
// `setImmediate` (importado de node:timers/promises — os timers falsos do
// vitest só trocam os globais).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

function builderDaReleitura() {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.single = vi.fn(() =>
    Promise.resolve({ data: { status: "pending" }, error: null }),
  );
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    rpc,
    from: vi.fn(() => builderDaReleitura()),
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
      subscribe: () => ({}),
      unsubscribe: () => {},
    }),
    removeChannel: () => {},
  },
}));

vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: () => {} }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE_DA_FILA = "orders_offline_updates_queue";
const ID_DO_TOAST = "toast-id";
const itemA = { orderId: "pedido-A", status: "processing", silent: false };
const itemB = { orderId: "pedido-B", status: "processing", silent: false };

const erroDeSeguranca = () =>
  new DOMException("The operation is insecure.", "SecurityError");
const erroDeCota = () =>
  new DOMException("The quota has been exceeded.", "QuotaExceededError");

let chamadasGetAdminOrdersPaged: unknown[] = [];
let host: HTMLDivElement;
let raiz: Root;
let armazem: Map<string, string>;
let rejeicoesNaoTratadas: unknown[];
let escutaDeRejeicao: (motivo: unknown) => void;

/** O que o armazenamento falha de lançar, SÓ para a chave da fila (as demais
 * chaves continuam funcionando, como num storage real com cota estourada). */
const falhas: {
  ler: Error | null;
  /** A leitura só lança a partir desta (1 = desde a primeira). */
  lerAPartirDaLeitura: number;
  setItem: Error | null;
  removeItem: Error | null;
} = { ler: null, lerAPartirDaLeitura: 1, setItem: null, removeItem: null };
let leiturasDaFila = 0;

function instalarRpc(
  opcoes: {
    falhaTransitoriaDe?: string;
    aoAplicar?: (orderId: string) => void;
  } = {},
) {
  chamadasGetAdminOrdersPaged = [];
  rpc.mockImplementation((nome: string, args: any) => {
    if (nome === "get_admin_orders_paged") {
      chamadasGetAdminOrdersPaged.push(args);
      return {
        abortSignal: () =>
          Promise.resolve({
            data: { data: [], total_count: 0 },
            error: null,
          }),
      };
    }
    if (
      nome === "update_order_status_atomic" &&
      args.p_order_id === opcoes.falhaTransitoriaDe
    ) {
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    if (nome === "update_order_status_atomic")
      opcoes.aoAplicar?.(args.p_order_id);
    return Promise.resolve({ data: null, error: null });
  });
}

function chamadasDaRpcDeStatus(): string[] {
  return rpc.mock.calls
    .filter(([nome]) => nome === "update_order_status_atomic")
    .map(([, args]) => args.p_order_id as string);
}

async function montarSondaAdmin(): Promise<
  (page?: number, pageSize?: number, status?: string) => Promise<unknown>
> {
  const { useOrders } = await import("@/hooks/useOrders");
  let carregar: (...args: any[]) => Promise<unknown> = async () => ({});
  function Sonda() {
    const { loadOrders } = useOrders(true, true);
    useEffect(() => {
      carregar = loadOrders;
    });
    return null;
  }
  await act(async () => {
    raiz.render(<Sonda />);
  });
  return (...args) => carregar(...args);
}

/** Monta, arma a "última consulta" do painel (é ela que a recarga pós-sync
 * repete) e zera o contador — o que sobrar é consequência da sincronização. */
async function prepararPainel() {
  const carregar = await montarSondaAdmin();
  await act(async () => {
    await carregar(0, 12, "all");
  });
  chamadasGetAdminOrdersPaged = [];
}

/** Gatilho que JÁ existe: o evento "online" + o segundo de espera. */
async function reconectar() {
  await act(async () => {
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(1000);
  });
  await esvaziar();
}

/** Passada disparada pelo timer armado na montagem (navigator.onLine=true). */
async function passarOSegundoDeEspera() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  await esvaziar();
}

/** Drena microtarefas e dá um ciclo REAL ao Node, onde `unhandledRejection`
 * é emitido. */
async function esvaziar() {
  await act(async () => {
    await proximoCicloReal();
    await proximoCicloReal();
  });
}

function filaNoArmazem(): unknown {
  const bruto = armazem.get(CHAVE_DA_FILA);
  return bruto === undefined ? undefined : JSON.parse(bruto);
}

function registrouErroDoSync(erro: unknown): boolean {
  return vi
    .mocked(console.error)
    .mock.calls.some(
      ([mensagem, ...resto]) =>
        typeof mensagem === "string" &&
        mensagem.includes("[Offline Sync]") &&
        resto.includes(erro),
    );
}

function nenhumToastDaSincronizacao() {
  expect(toast.loading).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.info).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
}

describe("useOrders — sincronização offline com armazenamento indisponível", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rpc.mockReset();
    instalarRpc();
    armazem = new Map();
    falhas.ler = null;
    falhas.lerAPartirDaLeitura = 1;
    leiturasDaFila = 0;
    falhas.setItem = null;
    falhas.removeItem = null;
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => {
        if (k === CHAVE_DA_FILA) {
          leiturasDaFila++;
          if (falhas.ler && leiturasDaFila >= falhas.lerAPartirDaLeitura) {
            throw falhas.ler;
          }
        }
        return armazem.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        if (k === CHAVE_DA_FILA && falhas.setItem) throw falhas.setItem;
        armazem.set(k, v);
      },
      removeItem: (k: string) => {
        if (k === CHAVE_DA_FILA && falhas.removeItem) throw falhas.removeItem;
        armazem.delete(k);
      },
      clear: () => armazem.clear(),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    vi.mocked(toast.loading).mockReturnValue(ID_DO_TOAST);
    // Um teste abaixo faz toast.error lançar; nenhum outro herda isso.
    vi.mocked(toast.error).mockReset();
    rejeicoesNaoTratadas = [];
    escutaDeRejeicao = (motivo) => {
      rejeicoesNaoTratadas.push(motivo);
    };
    process.on("unhandledRejection", escutaDeRejeicao);
  });

  afterEach(() => {
    process.off("unhandledRejection", escutaDeRejeicao);
    act(() => raiz.unmount());
    host.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("controle: storage saudável, fila com item -> RPC, fila removida, recarga silenciosa", async () => {
    armazem.set(CHAVE_DA_FILA, JSON.stringify([itemA]));
    await prepararPainel();

    await passarOSegundoDeEspera();

    expect(chamadasDaRpcDeStatus()).toEqual(["pedido-A"]);
    expect(armazem.has(CHAVE_DA_FILA)).toBe(false);
    expect(chamadasGetAdminOrdersPaged).toHaveLength(1);
    expect(toast.success).toHaveBeenCalledWith(
      "Todas as atualizações de status de pedidos foram sincronizadas!",
      { id: ID_DO_TOAST },
    );
    expect(rejeicoesNaoTratadas).toEqual([]);
  });

  describe("LEITURA da fila lança (SecurityError)", () => {
    it("não rejeita sem tratamento, registra o erro, não recarrega, não deixa toast e preserva a fila", async () => {
      armazem.set(CHAVE_DA_FILA, JSON.stringify([itemA]));
      const erro = erroDeSeguranca();
      falhas.ler = erro;
      await prepararPainel();

      await passarOSegundoDeEspera();

      // (a) a rejeição não pode escapar para o processo.
      expect(rejeicoesNaoTratadas).toEqual([]);
      // (b) o erro fica registrado, com a tag do sync offline e o erro real.
      expect(registrouErroDoSync(erro)).toBe(true);
      // (c) sincronização NÃO concluiu: nenhuma RPC, nenhuma recarga.
      expect(chamadasDaRpcDeStatus()).toEqual([]);
      expect(chamadasGetAdminOrdersPaged).toEqual([]);
      // (d) nenhum toast (nem de carregamento, nem de sucesso) ficou preso.
      nenhumToastDaSincronizacao();
      // a fila no storage continua exatamente como estava.
      expect(filaNoArmazem()).toEqual([itemA]);
    });

    it("quando o storage volta, o próximo evento 'online' processa a fila (a trava do voo foi solta)", async () => {
      armazem.set(CHAVE_DA_FILA, JSON.stringify([itemA]));
      falhas.ler = erroDeSeguranca();
      await prepararPainel();
      await passarOSegundoDeEspera();
      expect(chamadasDaRpcDeStatus()).toEqual([]);

      falhas.ler = null;
      await reconectar();

      expect(chamadasDaRpcDeStatus()).toEqual(["pedido-A"]);
      expect(armazem.has(CHAVE_DA_FILA)).toBe(false);
      expect(chamadasGetAdminOrdersPaged).toHaveLength(1);
      expect(toast.success).toHaveBeenCalledTimes(1);
      expect(rejeicoesNaoTratadas).toEqual([]);
    });
    it("falha na leitura da SEGUNDA passada: a primeira conclui (toast, fila, recarga) e o erro só fica registrado", async () => {
      // Passada 1 lê a fila (leitura 1) e relê a fresca (leitura 2) sem erro;
      // durante a RPC do pedido A o lojista enfileira B, o que arma a segunda
      // passada, cuja leitura (3) lança.
      const itemANovo = { ...itemA, timestamp: 1 };
      const itemBNovo = { ...itemB, timestamp: 2 };
      armazem.set(CHAVE_DA_FILA, JSON.stringify([itemANovo]));
      instalarRpc({
        aoAplicar: (id) => {
          if (id === "pedido-A") {
            armazem.set(CHAVE_DA_FILA, JSON.stringify([itemANovo, itemBNovo]));
          }
        },
      });
      const erro = erroDeSeguranca();
      falhas.ler = erro;
      falhas.lerAPartirDaLeitura = 3;
      await prepararPainel();

      await passarOSegundoDeEspera();

      expect(chamadasDaRpcDeStatus()).toEqual(["pedido-A"]);
      expect(registrouErroDoSync(erro)).toBe(true);
      // A passada 1 aplicou A de verdade: a recarga acontece e o toast dela
      // NÃO vira mensagem de falha por causa da leitura da passada 2.
      expect(chamadasGetAdminOrdersPaged).toHaveLength(1);
      expect(toast.error).not.toHaveBeenCalled();
      expect(toast.info).toHaveBeenCalledWith(
        "Alterações de pedidos sincronizadas. Há novas alterações na fila offline.",
        { id: ID_DO_TOAST },
      );
      expect(filaNoArmazem()).toEqual([itemBNovo]);
      expect(rejeicoesNaoTratadas).toEqual([]);
    });
  });

  describe("ESCRITA da fila lança DEPOIS das RPCs (setItem: cota estourada)", () => {
    it("resolve o toast com falha, não declara sucesso nem recarrega, e a fila antiga fica intacta", async () => {
      // A aplica; B falha por rede -> sobra [B] e a passada tenta setItem.
      armazem.set(CHAVE_DA_FILA, JSON.stringify([itemA, itemB]));
      instalarRpc({ falhaTransitoriaDe: "pedido-B" });
      const erro = erroDeCota();
      falhas.setItem = erro;
      await prepararPainel();

      await passarOSegundoDeEspera();

      expect(chamadasDaRpcDeStatus()).toEqual(["pedido-A", "pedido-B"]);
      expect(registrouErroDoSync(erro)).toBe(true);
      // O toast de carregamento é RESOLVIDO (mesmo id) com mensagem de falha.
      expect(toast.loading).toHaveBeenCalledTimes(1);
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Tentando novamente mais tarde"),
        { id: ID_DO_TOAST },
      );
      // Nunca "tudo sincronizado" e nunca recarga como se a fila tivesse avançado.
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.info).not.toHaveBeenCalled();
      expect(chamadasGetAdminOrdersPaged).toEqual([]);
      // Fila e estado preservados.
      expect(filaNoArmazem()).toEqual([itemA, itemB]);
      expect(rejeicoesNaoTratadas).toEqual([]);
    });

    it("quando o storage volta, o próximo 'online' reprocessa a fila e conclui", async () => {
      armazem.set(CHAVE_DA_FILA, JSON.stringify([itemA, itemB]));
      instalarRpc({ falhaTransitoriaDe: "pedido-B" });
      falhas.setItem = erroDeCota();
      await prepararPainel();
      await passarOSegundoDeEspera();

      falhas.setItem = null;
      instalarRpc();
      await reconectar();

      // A é reaplicado (a fila antiga ainda o tinha) e B finalmente passa.
      expect(chamadasDaRpcDeStatus()).toEqual([
        "pedido-A",
        "pedido-B",
        "pedido-A",
        "pedido-B",
      ]);
      expect(armazem.has(CHAVE_DA_FILA)).toBe(false);
      expect(chamadasGetAdminOrdersPaged).toHaveLength(1);
      expect(toast.success).toHaveBeenCalledTimes(1);
      expect(rejeicoesNaoTratadas).toEqual([]);
    });
  });

  describe("rede de segurança do chamador (o `.catch` do efeito 'online')", () => {
    it("se a própria passada rejeitar (toast.error lança no tratamento), o erro é registrado e não escapa nem recarrega", async () => {
      armazem.set(CHAVE_DA_FILA, JSON.stringify([itemA]));
      falhas.removeItem = erroDeSeguranca();
      const erroDoToast = new Error("sonner indisponível");
      vi.mocked(toast.error).mockImplementation(() => {
        throw erroDoToast;
      });
      await prepararPainel();

      await passarOSegundoDeEspera();

      expect(chamadasDaRpcDeStatus()).toEqual(["pedido-A"]);
      // (a) primeiro: a rejeição não pode escapar para o processo.
      expect(rejeicoesNaoTratadas).toEqual([]);
      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(registrouErroDoSync(erroDoToast)).toBe(true);
      expect(chamadasGetAdminOrdersPaged).toEqual([]);
      expect(filaNoArmazem()).toEqual([itemA]);
    });
  });

  describe("ESCRITA da fila lança DEPOIS das RPCs (removeItem: SecurityError)", () => {
    it("resolve o toast com falha, não declara sucesso nem recarrega, e a fila antiga fica intacta", async () => {
      armazem.set(CHAVE_DA_FILA, JSON.stringify([itemA]));
      const erro = erroDeSeguranca();
      falhas.removeItem = erro;
      await prepararPainel();

      await passarOSegundoDeEspera();

      expect(chamadasDaRpcDeStatus()).toEqual(["pedido-A"]);
      expect(registrouErroDoSync(erro)).toBe(true);
      expect(toast.loading).toHaveBeenCalledTimes(1);
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Tentando novamente mais tarde"),
        { id: ID_DO_TOAST },
      );
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.info).not.toHaveBeenCalled();
      expect(chamadasGetAdminOrdersPaged).toEqual([]);
      expect(filaNoArmazem()).toEqual([itemA]);
      expect(rejeicoesNaoTratadas).toEqual([]);
    });

    it("quando o storage volta, o próximo 'online' reprocessa a fila e conclui", async () => {
      armazem.set(CHAVE_DA_FILA, JSON.stringify([itemA]));
      falhas.removeItem = erroDeSeguranca();
      await prepararPainel();
      await passarOSegundoDeEspera();

      falhas.removeItem = null;
      await reconectar();

      expect(chamadasDaRpcDeStatus()).toEqual(["pedido-A", "pedido-A"]);
      expect(armazem.has(CHAVE_DA_FILA)).toBe(false);
      expect(chamadasGetAdminOrdersPaged).toHaveLength(1);
      expect(toast.success).toHaveBeenCalledTimes(1);
      expect(rejeicoesNaoTratadas).toEqual([]);
    });
  });
});
