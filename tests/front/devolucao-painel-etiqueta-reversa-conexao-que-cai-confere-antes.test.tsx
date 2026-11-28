// @vitest-environment jsdom
//
// "Gerar código de postagem" da devolução quando a conexão CAI no meio da
// chamada à edge (27/11/2026). No iPhone, trocar de app derruba o fetch na
// hora: `functions.invoke` não lança, devolve `{ data: null, error:
// FunctionsFetchError }` (functions-js 2.117.2). A compra do código pode ter
// saído e sido cobrada. Antes, só o prazo esgotado avisava para conferir;
// a queda rápida dizia "Tente de novo em instantes" e a ficha não era relida.
// Agora a queda segue o ramo do prazo: aviso de conferir + releitura da ficha.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  AVISO_COMPRA_REVERSA_NAO_CONCLUIDA,
  avisoDaRecusaDaEtiquetaReversa,
  useDevolucaoAdmin,
} from "@/hooks/useDevolucoesAdmin";
import { AVISO_RESGATE_ETIQUETA } from "@/lib/devolucao";
import {
  FunctionsFetchError,
  FunctionsHttpError,
} from "@supabase/functions-js";

const { rpc, invoke, toast } = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
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
    storage: { from: () => ({ createSignedUrl: vi.fn() }) },
  },
}));
vi.mock("sonner", () => ({ toast }));

const APROVADA = {
  id: "dev-etiqueta",
  protocolo: "DV-ETIQUETA",
  order_id: "pedido-etiqueta",
  tipo: "arrependimento",
  motivo: "tamanho_pequeno",
  detalhe: null,
  resolucao_desejada: "reembolso",
  resolucao_final: null,
  modalidade: "nacional",
  metodo_retorno: "etiqueta_reversa",
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
  mensagem_loja: null,
  observacao_inspecao: null,
  entregue_em: "2026-10-15T10:00:00Z",
  prazo_ate: "2026-10-22",
  politica: null,
  created_at: "2026-10-16T10:00:00Z",
  aprovada_em: "2026-10-16T11:00:00Z",
  postada_em: null,
  recebida_em: null,
  concluida_em: null,
  encerrada_em: null,
  itens: [],
  eventos: [],
  pedido: null,
};

let raiz: Root;
let hospedeiro: HTMLDivElement;
let ficha: ReturnType<typeof useDevolucaoAdmin>;
const aoMudar = vi.fn();

function Sonda() {
  const lida = useDevolucaoAdmin("dev-etiqueta", aoMudar);
  useEffect(() => {
    ficha = lida;
  });
  return null;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: APROVADA, error: null });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => raiz.render(<Sonda />));
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

it("a conexão caiu: avisa para conferir na ficha (pode ter sido cobrado) e relê a ficha", async () => {
  invoke.mockResolvedValue({
    data: null,
    error: new FunctionsFetchError(new TypeError("Load failed")),
  });
  // O servidor chegou a gravar o código antes de a conexão cair.
  rpc.mockResolvedValue({
    data: { ...APROVADA, codigo_postagem: "PX777BR" },
    error: null,
  });
  const leiturasAntes = rpc.mock.calls.length;

  let resultado!: boolean;
  await act(async () => {
    resultado = await ficha.gerarEtiquetaReversa();
  });

  expect(resultado).toBe(false);
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.warning).toHaveBeenCalledTimes(1);
  const [aviso] = toast.warning.mock.calls[0] as [string];
  expect(aviso).toContain("Confira na ficha se o código de postagem apareceu");
  expect(aviso).toContain(AVISO_RESGATE_ETIQUETA);
  expect(rpc.mock.calls.length).toBe(leiturasAntes + 1);
  expect(rpc).toHaveBeenLastCalledWith("devolucao_detalhe", {
    p_id: "dev-etiqueta",
  });
  expect(ficha.detalhe?.codigo_postagem).toBe("PX777BR");
  expect(ficha.emVoo).toBeNull();
});

it("controle: erro HTTP sem resgate (o servidor respondeu) segue 'tente de novo', sem releitura", async () => {
  invoke.mockResolvedValue({
    data: null,
    error: new FunctionsHttpError(
      new Response(JSON.stringify({ ok: false, erro: "Recusado." }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  });
  const leiturasAntes = rpc.mock.calls.length;

  await act(async () => {
    await ficha.gerarEtiquetaReversa();
  });

  expect(toast.warning).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(rpc.mock.calls.length).toBe(leiturasAntes);
});

// Caça 28/11 (M2): aprovar e concluir (com reembolso) passam pelo mesmo
// envelope. A queda devolve `{ error }` com `code: ""` e texto de fetch
// (postgrest-js); antes virava "Sem conexão… tente de novo" — e a RPC pode
// ter gravado (inclusive o reembolso). Agora segue o ramo do prazo.
const QUEDA = { message: "TypeError: Load failed", code: "" };

function gravacaoCai(nomeDaGravacao: string) {
  rpc.mockImplementation((nome: string) =>
    Promise.resolve(
      nome === nomeDaGravacao
        ? { data: null, error: QUEDA }
        : { data: APROVADA, error: null },
    ),
  );
}

it("aprovar: a conexão caiu — manda conferir na ficha (12 s), sem 'tente de novo', e relê", async () => {
  gravacaoCai("admin_devolucao_decidir");
  const leiturasAntes = rpc.mock.calls.filter(
    ([nome]) => nome === "devolucao_detalhe",
  ).length;

  let ok!: boolean;
  await act(async () => {
    ok = await ficha.aprovar({ mensagem: "", coletaEm: null });
  });

  expect(ok).toBe(false);
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.warning).toHaveBeenCalledWith(
    "Sem resposta da rede. Confira na ficha se a mudança apareceu antes de tentar de novo.",
    { duration: 12_000 },
  );
  expect(
    rpc.mock.calls.filter(([nome]) => nome === "devolucao_detalhe").length,
  ).toBeGreaterThan(leiturasAntes);
  expect(ficha.emVoo).toBeNull();
});

it("concluir com reembolso: a conexão caiu — manda conferir a conclusão e o reembolso na ficha", async () => {
  gravacaoCai("admin_devolucao_concluir");

  let r: unknown;
  await act(async () => {
    r = await ficha.concluir({
      resolucao: "reembolso",
      itens: [],
      valorReembolso: 100,
      observacao: "",
    });
  });

  expect(r).toBeNull();
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.warning).toHaveBeenCalledWith(
    "Sem resposta da rede. Confira na ficha se a devolução foi concluída e se o reembolso aparece antes de tentar de novo.",
    { duration: 12_000 },
  );
  // A tela não aciona o Mercado Pago sem saber o id do reembolso.
  expect(invoke).not.toHaveBeenCalled();
});

it("controle: recusa do servidor (com código) segue a frase do banco, em erro", async () => {
  rpc.mockImplementation((nome: string) =>
    Promise.resolve(
      nome === "admin_devolucao_decidir"
        ? {
            data: null,
            error: {
              code: "P0001",
              message: "Esta devolução já foi decidida.",
            },
          }
        : { data: APROVADA, error: null },
    ),
  );

  await act(async () => {
    await ficha.aprovar({ mensagem: "", coletaEm: null });
  });

  expect(toast.warning).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith("Esta devolução já foi decidida.");
});

// Caça 28/11 (M1): só as recusas do PAGAMENTO (a edge já diz "nada foi pago")
// ganham a orientação do carrinho; o resto mostra a frase da edge como veio.
it.each([
  'O Melhor Envio não fechou a compra do envio reverso (status "pending") — nada foi pago, o envio saiu do carrinho e o código de postagem não foi gerado. Confira o saldo da sua conta no Melhor Envio e tente de novo.',
  "O Melhor Envio recusou o pagamento do envio reverso (erro 422). Motivo informado: Saldo insuficiente",
  'O Melhor Envio recusou a compra do envio reverso (id 0b0e…, status "canceled") — nada foi pago, o envio saiu do carrinho. Não consegui soltar o vínculo desta devolução com ele agora, mas a próxima tentativa de gerar o código já deve destravar sozinha.',
])(
  "compra recusada vira a orientação, com a frase da edge no detalhe: %s",
  (erro) => {
    expect(avisoDaRecusaDaEtiquetaReversa(erro)).toEqual({
      titulo: AVISO_COMPRA_REVERSA_NAO_CONCLUIDA,
      detalhe: erro,
    });
  },
);

it.each([
  "O Melhor Envio recusou a criação do envio reverso (erro 422).",
  "Já existe uma geração do código de postagem em andamento para esta devolução. Aguarde alguns instantes e recarregue.",
  "O Melhor Envio recusou o token (não autenticado). Gere um novo token na sua conta e atualize em Logística & Frete.",
])("o que não é recusa do pagamento passa como veio: %s", (erro) => {
  expect(avisoDaRecusaDaEtiquetaReversa(erro)).toEqual({
    titulo: erro,
    detalhe: null,
  });
});
