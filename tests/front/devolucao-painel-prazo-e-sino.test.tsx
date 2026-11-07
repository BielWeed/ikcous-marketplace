// @vitest-environment jsdom
//
// Ficha de devolução do painel (useDevolucaoAdmin), dois defeitos de campo:
//
// 1. Rede "pendurada" (conecta e não responde): aprovar, recusar, receber,
//    concluir com reembolso, gerar código de postagem e o estorno depois de
//    concluir ficavam girando para sempre, com a trava da ficha inteira presa e
//    nenhuma frase. Agora cada chamada tem prazo; no estouro a tela se solta, a
//    ficha é relida (a gravação pode ter chegado) e a frase NUNCA diz que "não
//    foi feito" — principalmente no dinheiro.
// 2. A bolinha vermelha do sino ficava acesa depois de decidir a última
//    devolução: o AdminLayout só recontava ao ouvir `admin:recontar-avisos`, e
//    quem decide devolução nunca o disparava.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDevolucaoAdmin } from "@/hooks/useDevolucoesAdmin";

const { rpc, invoke, createSignedUrl, toast } = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  createSignedUrl: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    functions: { invoke },
    storage: { from: () => ({ createSignedUrl }) },
  },
}));
vi.mock("sonner", () => ({ toast }));

type Resposta = { data: unknown; error: unknown };

/** Rede pendurada: a promessa nunca responde sozinha. */
function pendurada() {
  let resolver!: (resposta: Resposta) => void;
  const promessa = new Promise<Resposta>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

const RECEBIDA = {
  id: "dev-a",
  protocolo: "DV-A",
  order_id: "pedido-a",
  tipo: "arrependimento",
  motivo: "tamanho_pequeno",
  detalhe: null,
  resolucao_desejada: "reembolso",
  resolucao_final: null,
  modalidade: "local",
  metodo_retorno: "entrega_na_loja",
  status: "recebida",
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
  mensagem_loja: null,
  observacao_inspecao: null,
  entregue_em: "2026-10-15T10:00:00Z",
  prazo_ate: "2026-10-22",
  politica: null,
  created_at: "2026-10-16T10:00:00Z",
  aprovada_em: "2026-10-16T11:00:00Z",
  postada_em: null,
  recebida_em: "2026-10-16T12:00:00Z",
  concluida_em: null,
  encerrada_em: null,
  itens: [],
  eventos: [],
  pedido: null,
};
const SOLICITADA = { ...RECEBIDA, status: "solicitada", recebida_em: null };
const APROVADA = { ...SOLICITADA, status: "aprovada" };
const CONCLUIDA = {
  ...RECEBIDA,
  status: "concluida",
  resolucao_final: "reembolso",
  concluida_em: "2026-10-16T13:00:00Z",
};

const CONCLUSAO_COM_REEMBOLSO = {
  id: "dev-a",
  status: "concluida",
  resolucao: "reembolso",
  valor_reembolso: 100,
  refund_id: "ref-1",
  reembolso_manual: false,
  reestocados: 0,
};

/** O que o servidor responde a cada RPC; trocável por teste. */
const servidor = {
  detalhe: RECEBIDA as unknown,
  respostas: new Map<string, Promise<Resposta> | Resposta>(),
};

function rpcDoServidor(nome: string): Promise<Resposta> {
  if (nome === "devolucao_detalhe") {
    return Promise.resolve({ data: servidor.detalhe, error: null });
  }
  const dada = servidor.respostas.get(nome);
  return Promise.resolve(dada ?? { data: null, error: null });
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
let ficha: ReturnType<typeof useDevolucaoAdmin>;
const aoMudar = vi.fn();
const sino = vi.fn();

function Sonda() {
  const lida = useDevolucaoAdmin("dev-a", aoMudar);
  useEffect(() => {
    ficha = lida;
  });
  return null;
}

const PRAZO_RPC_MS = 20_000;
const PRAZO_EDGE_MS = 30_000;

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function textosDoToast(): string {
  return [toast.success, toast.error, toast.warning, toast.info]
    .flatMap((f) => f.mock.calls.map((c) => String(c[0])))
    .join(" | ");
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.clearAllMocks();
  servidor.detalhe = RECEBIDA;
  servidor.respostas.clear();
  rpc.mockImplementation(rpcDoServidor);
  invoke.mockResolvedValue({ data: { status: "concluido" }, error: null });
  createSignedUrl.mockResolvedValue({ data: { signedUrl: "x" }, error: null });
  window.addEventListener("admin:recontar-avisos", sino);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => raiz.render(<Sonda />));
});

afterEach(() => {
  window.removeEventListener("admin:recontar-avisos", sino);
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

describe("prazo das ações da ficha de devolução", () => {
  it.each([
    ["aprovar", "admin_devolucao_decidir"],
    ["recusar", "admin_devolucao_decidir"],
    ["marcarRecebida", "admin_devolucao_registrar"],
    ["marcarEmTransito", "admin_devolucao_registrar"],
    ["reprovar", "admin_devolucao_reprovar"],
    ["liberarVinculoReverso", "admin_devolucao_liberar_vinculo_reverso"],
  ] as const)(
    "%s com a rede pendurada: solta a ficha, avisa sem dizer que não foi feito e relê",
    async (acao, rpcDaAcao) => {
      servidor.detalhe = SOLICITADA;
      await act(async () => ficha.recarregar());
      const parada = pendurada();
      servidor.respostas.set(rpcDaAcao, parada.promessa);
      const leiturasAntes = rpc.mock.calls.filter(
        (c) => c[0] === "devolucao_detalhe",
      ).length;

      let terminou = false;
      act(() => {
        const chamada =
          acao === "aprovar"
            ? ficha.aprovar({ mensagem: "", coletaEm: null })
            : acao === "recusar"
              ? ficha.recusar("sem estoque")
              : acao === "marcarRecebida"
                ? ficha.marcarRecebida()
                : acao === "marcarEmTransito"
                  ? ficha.marcarEmTransito("AB1")
                  : acao === "reprovar"
                    ? ficha.reprovar("amassado")
                    : ficha.liberarVinculoReverso();
        void chamada.then(() => {
          terminou = true;
        });
      });
      expect(ficha.emVoo).not.toBeNull();

      // O servidor gravou, mas a resposta nunca chega.
      servidor.detalhe = APROVADA;
      await passar(PRAZO_RPC_MS);

      expect(terminou).toBe(true);
      expect(ficha.emVoo).toBeNull();
      expect(ficha.detalhe?.status).toBe("aprovada");
      expect(
        rpc.mock.calls.filter((c) => c[0] === "devolucao_detalhe").length,
      ).toBeGreaterThan(leiturasAntes);
      expect(toast.warning).toHaveBeenCalledWith(
        expect.stringContaining("Sem resposta da rede"),
        expect.anything(),
      );
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      expect(textosDoToast()).not.toMatch(/não foi feit|não deu certo|falhou/i);

      // A resposta que chega TARDE não vira aviso de sucesso nem mexe na ficha.
      await act(async () => {
        parada.resolver({
          data: { id: "dev-a", status: "recusada" },
          error: null,
        });
        await Promise.resolve();
      });
      expect(toast.success).not.toHaveBeenCalled();
      expect(ficha.detalhe?.status).toBe("aprovada");
    },
  );

  it("concluir com reembolso pendurado: não afirma que o reembolso não saiu e não chama o estorno", async () => {
    servidor.respostas.set("admin_devolucao_concluir", pendurada().promessa);
    let resultado: unknown = "pendente";
    act(() => {
      void ficha
        .concluir({
          resolucao: "reembolso",
          itens: [],
          valorReembolso: 100,
          observacao: "",
        })
        .then((r) => {
          resultado = r;
        });
    });
    expect(ficha.emVoo).toBe("concluir");

    servidor.detalhe = CONCLUIDA;
    await passar(PRAZO_RPC_MS);

    expect(resultado).toBeNull();
    expect(ficha.emVoo).toBeNull();
    // Mostra o estado real do servidor: a devolução já estava concluída.
    expect(ficha.detalhe?.status).toBe("concluida");
    expect(invoke).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringMatching(
        /Sem resposta da rede.*(reembolso|devolução).*antes de tentar de novo/s,
      ),
      expect.anything(),
    );
    expect(textosDoToast()).not.toMatch(
      /não foi feit|não saiu|não foi concluíd|nada foi/i,
    );
  });

  it("enquanto o prazo corre a trava segura o segundo toque; depois da releitura ela solta", async () => {
    servidor.respostas.set("admin_devolucao_decidir", pendurada().promessa);
    act(() => {
      void ficha.aprovar({ mensagem: "", coletaEm: null });
    });
    const chamadasAntes = rpc.mock.calls.filter(
      (c) => c[0] === "admin_devolucao_decidir",
    ).length;
    let segundo: boolean | undefined;
    await act(async () => {
      segundo = await ficha.aprovar({ mensagem: "", coletaEm: null });
    });
    expect(segundo).toBe(false);
    expect(
      rpc.mock.calls.filter((c) => c[0] === "admin_devolucao_decidir").length,
    ).toBe(chamadasAntes);

    await passar(PRAZO_RPC_MS);
    expect(ficha.emVoo).toBeNull();
  });

  it("a releitura da ficha que também não responde não prende a trava para sempre", async () => {
    servidor.respostas.set("admin_devolucao_decidir", pendurada().promessa);
    let terminou = false;
    act(() => {
      void ficha.aprovar({ mensagem: "", coletaEm: null }).then(() => {
        terminou = true;
      });
    });
    // A partir daqui a leitura da ficha também fica pendurada.
    rpc.mockImplementation((nome: string) =>
      nome === "devolucao_detalhe" ? pendurada().promessa : rpcDoServidor(nome),
    );
    await passar(PRAZO_RPC_MS);
    expect(ficha.emVoo).not.toBeNull();
    await passar(15_000);
    expect(terminou).toBe(true);
    expect(ficha.emVoo).toBeNull();
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining("Sem resposta da rede"),
      expect.anything(),
    );
  });

  it("gerar código de postagem pendurado: solta, relê a ficha e manda conferir antes de repetir", async () => {
    invoke.mockReturnValue(pendurada().promessa);
    let terminou: boolean | undefined;
    act(() => {
      void ficha.gerarEtiquetaReversa().then((r) => {
        terminou = r;
      });
    });
    expect(ficha.emVoo).toBe("etiqueta");
    const leiturasAntes = rpc.mock.calls.filter(
      (c) => c[0] === "devolucao_detalhe",
    ).length;

    await passar(PRAZO_EDGE_MS);

    expect(terminou).toBe(false);
    expect(ficha.emVoo).toBeNull();
    expect(
      rpc.mock.calls.filter((c) => c[0] === "devolucao_detalhe").length,
    ).toBeGreaterThan(leiturasAntes);
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringMatching(
        /Sem resposta da rede.*código de postagem.*antes de tentar de novo/s,
      ),
      expect.anything(),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(textosDoToast()).not.toMatch(/não foi feit|não consegui gerar/i);
  });

  it("estorno pendurado depois de concluir: não diz que o reembolso não saiu e mostra a ficha real", async () => {
    servidor.respostas.set("admin_devolucao_concluir", {
      data: CONCLUSAO_COM_REEMBOLSO,
      error: null,
    });
    servidor.detalhe = CONCLUIDA;
    invoke.mockReturnValue(pendurada().promessa);
    let resultado: unknown = "pendente";
    act(() => {
      void ficha
        .concluir({
          resolucao: "reembolso",
          itens: [],
          valorReembolso: 100,
          observacao: "",
        })
        .then((r) => {
          resultado = r;
        });
    });
    await passar(0);
    expect(invoke).toHaveBeenCalledWith("estornar-pagamento", {
      body: { refund_id: "ref-1" },
    });
    expect(resultado).toBe("pendente");
    const leiturasAntes = rpc.mock.calls.filter(
      (c) => c[0] === "devolucao_detalhe",
    ).length;

    await passar(PRAZO_EDGE_MS);

    expect(resultado).toEqual(expect.objectContaining({ refund_id: "ref-1" }));
    expect(
      rpc.mock.calls.filter((c) => c[0] === "devolucao_detalhe").length,
    ).toBeGreaterThan(leiturasAntes);
    expect(ficha.detalhe?.status).toBe("concluida");
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringMatching(/Mercado Pago não respondeu.*pode já ter saído/s),
      expect.anything(),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(textosDoToast()).not.toMatch(
      /não foi feit|não saiu|em até 10 minutos/i,
    );
  });
});

describe("sino do painel depois de decidir uma devolução", () => {
  it("decisão que deu certo manda o sino recontar", async () => {
    servidor.detalhe = SOLICITADA;
    await act(async () => ficha.recarregar());
    servidor.respostas.set("admin_devolucao_decidir", {
      data: { id: "dev-a", status: "aprovada" },
      error: null,
    });
    servidor.detalhe = APROVADA;
    await act(async () => {
      await ficha.aprovar({ mensagem: "", coletaEm: null });
    });
    expect(toast.success).toHaveBeenCalled();
    expect(sino).toHaveBeenCalledTimes(1);
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it("decisão recusada pelo servidor (nada mudou) não manda o sino recontar", async () => {
    servidor.respostas.set("admin_devolucao_decidir", {
      data: null,
      error: { message: "A devolução já não está solicitada." },
    });
    await act(async () => {
      await ficha.recusar("motivo");
    });
    expect(sino).not.toHaveBeenCalled();
  });

  it("prazo estourado: a gravação pode ter chegado, então o sino reconta também", async () => {
    servidor.respostas.set("admin_devolucao_decidir", pendurada().promessa);
    act(() => {
      void ficha.recusar("motivo");
    });
    await passar(PRAZO_RPC_MS);
    expect(sino).toHaveBeenCalledTimes(1);
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });
});
