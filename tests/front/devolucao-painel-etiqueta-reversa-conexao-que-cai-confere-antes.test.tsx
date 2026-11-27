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

import { useDevolucaoAdmin } from "@/hooks/useDevolucoesAdmin";
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
