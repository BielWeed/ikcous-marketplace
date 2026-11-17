// @vitest-environment jsdom
//
// Ao aprovar uma devolução, o aviso para a cliente é uma notificação que pode
// falhar sem a tela saber. O toast da lojista, então, só confirma o que a
// tela viu (a aprovação gravada) — nunca promete "O cliente foi avisado".
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDevolucaoAdmin } from "@/hooks/useDevolucoesAdmin";

const { rpc, createSignedUrl } = vi.hoisted(() => ({
  rpc: vi.fn(),
  createSignedUrl: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc, storage: { from: () => ({ createSignedUrl }) } },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const SOLICITADA = {
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
  status: "solicitada",
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
  aprovada_em: null,
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
let leitura: ReturnType<typeof useDevolucaoAdmin>;

function Sonda() {
  const lida = useDevolucaoAdmin("dev-a");
  useEffect(() => {
    leitura = lida;
  });
  return null;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  rpc.mockImplementation((nome: string) =>
    Promise.resolve({
      data:
        nome === "admin_devolucao_decidir"
          ? { id: "dev-a", status: "aprovada" }
          : SOLICITADA,
      error: null,
    }),
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => raiz.render(<Sonda />));
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

describe("aprovar devolução — o aviso da lojista", () => {
  it("diz só 'Devolução aprovada.' e não promete que o cliente foi avisado", async () => {
    let ok = false;
    await act(async () => {
      ok = await leitura.aprovar({ mensagem: "", coletaEm: null });
    });

    expect(ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "admin_devolucao_decidir",
      expect.objectContaining({ p_id: "dev-a", p_aprovar: true }),
    );
    expect(toast.success).toHaveBeenCalledExactlyOnceWith(
      "Devolução aprovada.",
    );
  });
});
