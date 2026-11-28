// @vitest-environment jsdom
//
// Conclusão da devolução no PAINEL (useDevolucaoAdmin.concluir), duas decisões do sócio (28/11/2026):
//
// 1. A peça de produto EXCLUÍDO não volta ao estoque (migration 20261659000000): a resposta da conclusão traz
//    `fora_do_estoque` e o aviso diz à lojista o que aconteceu e o que fazer. `reestocados` conta só o que voltou
//    à venda. Banco sem a migration não manda a chave: nenhuma frase nova.
// 2. Dois aparelhos concluindo a mesma devolução: o segundo recebe a recusa do banco. A tela relê a devolução e,
//    se ela já está "concluída", diz isso em vez da frase crua do banco, e atualiza a ficha. Não depende do texto
//    do erro: qualquer recusa seguida de ficha concluída é "já concluída em outro aparelho".
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDevolucaoAdmin } from "@/hooks/useDevolucoesAdmin";

const { rpc, createSignedUrl, toast } = vi.hoisted(() => ({
  rpc: vi.fn(),
  createSignedUrl: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc, storage: { from: () => ({ createSignedUrl }) } },
}));
vi.mock("sonner", () => ({ toast }));

const RECEBIDA = {
  id: "dev-a",
  protocolo: "DV-A",
  order_id: "pedido-a",
  tipo: "arrependimento",
  motivo: "tamanho_pequeno",
  detalhe: null,
  resolucao_desejada: "troca",
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
  entregue_em: "2026-11-15T10:00:00Z",
  prazo_ate: "2026-11-22",
  politica: null,
  created_at: "2026-11-16T10:00:00Z",
  aprovada_em: "2026-11-16T11:00:00Z",
  postada_em: null,
  recebida_em: "2026-11-16T12:00:00Z",
  concluida_em: null,
  encerrada_em: null,
  itens: [],
  eventos: [],
  pedido: null,
};
const CONCLUIDA = {
  ...RECEBIDA,
  status: "concluida",
  resolucao_final: "troca",
  concluida_em: "2026-11-16T13:00:00Z",
};

const FRASE_EXCLUIDO_1 =
  "O produto foi excluído, então a peça não voltou ao estoque. Se você ainda vende essa peça, some 1 no estoque do produto certo.";
const OUTRO_APARELHO = "Essa devolução já foi concluída em outro aparelho";

let raiz: Root;
let hospedeiro: HTMLDivElement;
let leitura: ReturnType<typeof useDevolucaoAdmin>;
const aoMudar = vi.fn();

function Sonda({ id }: { id: string | null }) {
  const lida = useDevolucaoAdmin(id, aoMudar);
  useEffect(() => {
    leitura = lida;
  });
  return null;
}

/** A resposta de cada RPC, por nome; o que faltar responde a ficha recebida. */
function responder(porNome: Record<string, { data: unknown; error: unknown }>) {
  const respostas = new Map(Object.entries(porNome));
  rpc.mockImplementation((nome: string) =>
    Promise.resolve(respostas.get(nome) ?? { data: RECEBIDA, error: null }),
  );
}

const resultado = (extra: Record<string, unknown>) => ({
  id: "dev-a",
  status: "concluida",
  resolucao: "troca",
  valor_reembolso: null,
  refund_id: null,
  reembolso_manual: false,
  reestocados: 0,
  sem_tamanho: 0,
  ...extra,
});

async function concluir() {
  let r: Awaited<ReturnType<typeof leitura.concluir>> = null;
  await act(async () => {
    r = await leitura.concluir({
      resolucao: "troca",
      itens: [],
      valorReembolso: null,
      observacao: "",
    });
  });
  return r;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: RECEBIDA, error: null });
  createSignedUrl.mockResolvedValue({ data: null, error: null });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => raiz.render(<Sonda id="dev-a" />));
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("a peça de produto excluído não voltou ao estoque (20261659000000)", () => {
  it("uma peça fora do estoque: o aviso diz o que aconteceu e o que fazer, e não diz que voltou", async () => {
    responder({
      admin_devolucao_concluir: {
        data: resultado({ fora_do_estoque: 1 }),
        error: null,
      },
      devolucao_detalhe: { data: CONCLUIDA, error: null },
    });
    const r = await concluir();
    expect(r).toMatchObject({ reestocados: 0, fora_do_estoque: 1 });
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(
      `Devolução concluída. ${FRASE_EXCLUIDO_1}`,
    );
    expect(String(toast.success.mock.calls[0][0])).not.toMatch(
      /unidades? volt/,
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("com peça que voltou à venda junto: as duas contas, cada uma no seu lugar", async () => {
    responder({
      admin_devolucao_concluir: {
        data: resultado({ reestocados: 2, fora_do_estoque: 1 }),
        error: null,
      },
      devolucao_detalhe: { data: CONCLUIDA, error: null },
    });
    await concluir();
    expect(toast.success).toHaveBeenCalledWith(
      `Devolução concluída. 2 unidades voltaram ao estoque. ${FRASE_EXCLUIDO_1}`,
    );
  });

  it("duas peças fora do estoque: a frase conta as duas", async () => {
    responder({
      admin_devolucao_concluir: {
        data: resultado({ fora_do_estoque: 2 }),
        error: null,
      },
      devolucao_detalhe: { data: CONCLUIDA, error: null },
    });
    await concluir();
    expect(toast.success).toHaveBeenCalledWith(
      "Devolução concluída. O produto foi excluído, então 2 peças não voltaram ao estoque. Se você ainda vende essas peças, some 2 no estoque do produto certo.",
    );
  });

  it("banco sem a migration (sem a chave) ou com zero: o aviso de sempre", async () => {
    for (const extra of [
      { reestocados: 1 },
      { reestocados: 1, fora_do_estoque: 0 },
    ]) {
      toast.success.mockClear();
      responder({
        admin_devolucao_concluir: { data: resultado(extra), error: null },
        devolucao_detalhe: { data: CONCLUIDA, error: null },
      });
      await concluir();
      expect(toast.success).toHaveBeenCalledWith(
        "Devolução concluída. 1 unidade voltou ao estoque.",
      );
    }
  });
});

describe("dois aparelhos concluindo a mesma devolução", () => {
  it("a recusa do banco com a ficha já concluída vira o aviso do outro aparelho, e a ficha atualiza", async () => {
    responder({
      // Frase qualquer: a tela não depende do texto do erro.
      admin_devolucao_concluir: {
        data: null,
        error: { message: "qualquer coisa que o banco disser" },
      },
      devolucao_detalhe: { data: CONCLUIDA, error: null },
    });
    const r = await concluir();
    expect(r).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
    const avisos = [
      ...toast.info.mock.calls,
      ...toast.warning.mock.calls,
      ...toast.success.mock.calls,
    ].map((c) => String(c[0]));
    expect(avisos).toEqual([OUTRO_APARELHO]);
    expect(leitura.detalhe?.status).toBe("concluida");
    // A lista do painel e o sino também são avisados (a devolução mudou de situação).
    expect(aoMudar).toHaveBeenCalled();
    // A ficha foi relida DEPOIS da recusa (a leitura que decidiu o aviso).
    const nomes = rpc.mock.calls.map((c) => c[0]);
    expect(nomes.lastIndexOf("devolucao_detalhe")).toBeGreaterThan(
      nomes.indexOf("admin_devolucao_concluir"),
    );
    // Destrava: a lojista pode agir na ficha atualizada.
    expect(leitura.emVoo).toBeNull();
  });

  it("recusa com a ficha ainda recebida: o erro do banco, como sempre", async () => {
    responder({
      admin_devolucao_concluir: {
        data: null,
        error: { message: "Informe a condição de cada item recebido." },
      },
      devolucao_detalhe: { data: RECEBIDA, error: null },
    });
    await concluir();
    expect(toast.error).toHaveBeenCalledWith(
      "Informe a condição de cada item recebido.",
    );
    const avisos = [...toast.info.mock.calls, ...toast.warning.mock.calls].map(
      (c) => String(c[0]),
    );
    expect(avisos).not.toContain(OUTRO_APARELHO);
    expect(leitura.detalhe?.status).toBe("recebida");
  });

  it("recusa e a releitura também falha: o erro do banco (nunca afirmar o que não se leu)", async () => {
    responder({
      admin_devolucao_concluir: {
        data: null,
        error: { message: "Devolução não está recebida." },
      },
      devolucao_detalhe: { data: null, error: { message: "rede" } },
    });
    await concluir();
    expect(toast.error).toHaveBeenCalledWith("Devolução não está recebida.");
    const avisos = [...toast.info.mock.calls, ...toast.warning.mock.calls].map(
      (c) => String(c[0]),
    );
    expect(avisos).not.toContain(OUTRO_APARELHO);
  });

  it("quem decide é a releitura DEPOIS da recusa: com a ficha da tela já concluída, o aviso é o do outro aparelho", async () => {
    // A ficha na tela já dizia concluída (resposta atrasada de outra aba, por exemplo) e o banco recusa: a
    // releitura confirma concluída. O aviso é o do outro aparelho (a conclusão não foi deste clique).
    rpc.mockResolvedValueOnce({ data: CONCLUIDA, error: null });
    await act(async () => leitura.recarregar());
    responder({
      admin_devolucao_concluir: {
        data: null,
        error: { message: "Devolução não está recebida." },
      },
      devolucao_detalhe: { data: CONCLUIDA, error: null },
    });
    await concluir();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(OUTRO_APARELHO);
  });

  it("outra ação recusada (não a conclusão) segue com o erro do banco mesmo se a ficha estiver concluída", async () => {
    responder({
      admin_devolucao_reprovar: {
        data: null,
        error: { message: "Devolução não está recebida." },
      },
      devolucao_detalhe: { data: CONCLUIDA, error: null },
    });
    await act(async () => {
      await leitura.reprovar("motivo qualquer");
    });
    expect(toast.error).toHaveBeenCalledWith("Devolução não está recebida.");
    expect(toast.info).not.toHaveBeenCalledWith(OUTRO_APARELHO);
  });
});
