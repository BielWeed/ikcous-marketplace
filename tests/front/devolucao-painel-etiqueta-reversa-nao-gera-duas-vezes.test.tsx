// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useDevolucaoAdmin } from "@/hooks/useDevolucoesAdmin";

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

it("dois toques no mesmo instante compram só uma etiqueta e liberam a ficha ao terminar", async () => {
  let resolver!: (resposta: { data: unknown; error: null }) => void;
  invoke.mockReturnValue(
    new Promise((resolve) => {
      resolver = resolve;
    }),
  );
  let primeira!: Promise<boolean>;
  let segunda!: Promise<boolean>;
  // Chamadas diretas ao hook: não passam pela trava de executar/aprovar
  // nem pelo botão desabilitado da tela.
  act(() => {
    primeira = ficha.gerarEtiquetaReversa();
    segunda = ficha.gerarEtiquetaReversa();
  });

  try {
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("melhor-envio-etiqueta", {
      body: {
        action: "gerar_devolucao_reversa",
        devolucao_id: "dev-etiqueta",
      },
    });
    await expect(segunda).resolves.toBe(false);
    expect(ficha.emVoo).toBe("etiqueta");
    expect(aoMudar).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  } finally {
    // Também termina as promessas no mutante, sem deixar prazo/rejeição órfãos.
    rpc.mockResolvedValue({
      data: { ...APROVADA, codigo_postagem: "PX999BR" },
      error: null,
    });
    await act(async () => {
      resolver({
        data: {
          ok: true,
          codigo_postagem: "PX999BR",
          etiqueta_url: "https://example.com/etiqueta.pdf",
          me_reverse_id: "reversa-teste",
        },
        error: null,
      });
      await Promise.all([primeira, segunda]);
    });
  }

  await expect(primeira).resolves.toBe(true);
  expect(ficha.emVoo).toBeNull();
  expect(ficha.detalhe?.codigo_postagem).toBe("PX999BR");
  expect(rpc).toHaveBeenLastCalledWith("devolucao_detalhe", {
    p_id: "dev-etiqueta",
  });
  expect(aoMudar).toHaveBeenCalledTimes(1);
  expect(toast.success).toHaveBeenCalledTimes(1);
  expect(toast.error).not.toHaveBeenCalled();
});
