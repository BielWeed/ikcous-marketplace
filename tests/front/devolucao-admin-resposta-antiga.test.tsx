// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
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

type Resposta = { data: unknown; error: unknown };

function pendente() {
  let resolver!: (resposta: Resposta) => void;
  let rejeitar!: (erro: Error) => void;
  const promessa = new Promise<Resposta>((resolve, reject) => {
    resolver = resolve;
    rejeitar = reject;
  });
  return { promessa, resolver, rejeitar };
}

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
const CONCLUIDA = {
  ...RECEBIDA,
  status: "concluida",
  resolucao_final: "troca",
  concluida_em: "2026-10-16T13:00:00Z",
};

let raiz: Root;
let hospedeiro: HTMLDivElement;
let leitura: ReturnType<typeof useDevolucaoAdmin>;

function Sonda({ id }: { id: string | null }) {
  const lida = useDevolucaoAdmin(id);
  useEffect(() => {
    leitura = lida;
  });
  return null;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: RECEBIDA, error: null });
  createSignedUrl.mockResolvedValue({
    data: { signedUrl: "https://foto.test/a" },
    error: null,
  });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => raiz.render(<Sonda id="dev-a" />));
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

describe("detalhe admin aceita apenas a leitura mais recente", () => {
  it("a atualização anterior não desfaz a releitura feita ao concluir", async () => {
    expect(leitura.detalhe?.status).toBe("recebida");
    const antiga = pendente();
    rpc.mockReturnValueOnce(antiga.promessa);
    let atualizacao!: Promise<void>;
    act(() => {
      atualizacao = leitura.recarregar();
    });
    expect(leitura.carregando).toBe(true);

    rpc.mockImplementation((nome: string) =>
      Promise.resolve({
        data:
          nome === "admin_devolucao_concluir"
            ? {
                id: "dev-a",
                status: "concluida",
                resolucao: "troca",
                valor_reembolso: null,
                refund_id: null,
                reembolso_manual: false,
                reestocados: 0,
              }
            : CONCLUIDA,
        error: null,
      }),
    );
    await act(async () => {
      await leitura.concluir({
        resolucao: "troca",
        itens: [],
        valorReembolso: null,
        observacao: "",
      });
    });
    expect(leitura.detalhe?.status).toBe("concluida");
    expect(leitura.carregando).toBe(false);

    await act(async () => {
      antiga.resolver({ data: RECEBIDA, error: null });
      await atualizacao;
    });
    expect(leitura.detalhe?.status).toBe("concluida");
    expect(leitura.erro).toBe(false);
    expect(leitura.carregando).toBe(false);
  });

  it.each(["rpc", "rede"])(
    "erro antigo de %s não invalida a leitura nova",
    async (tipo) => {
      const antiga = pendente();
      rpc.mockReturnValueOnce(antiga.promessa);
      let atualizacao!: Promise<void>;
      act(() => {
        atualizacao = leitura.recarregar();
      });
      rpc.mockResolvedValueOnce({ data: CONCLUIDA, error: null });
      await act(async () => leitura.recarregar());

      await act(async () => {
        if (tipo === "rpc") {
          antiga.resolver({ data: null, error: { message: "falha antiga" } });
        } else {
          antiga.rejeitar(new Error("rede"));
        }
        await atualizacao;
      });
      expect(leitura.detalhe?.status).toBe("concluida");
      expect(leitura.erro).toBe(false);
      expect(leitura.carregando).toBe(false);
    },
  );

  it("descartar a resposta antiga não encerra o carregamento da nova", async () => {
    const antiga = pendente();
    const nova = pendente();
    rpc.mockReturnValueOnce(antiga.promessa).mockReturnValueOnce(nova.promessa);
    let primeira!: Promise<void>;
    let segunda!: Promise<void>;
    act(() => {
      primeira = leitura.recarregar();
      segunda = leitura.recarregar();
    });
    await act(async () => {
      antiga.resolver({ data: RECEBIDA, error: null });
      await primeira;
    });
    expect(leitura.carregando).toBe(true);
    await act(async () => {
      nova.resolver({ data: CONCLUIDA, error: null });
      await segunda;
    });
    expect(leitura.detalhe?.status).toBe("concluida");
    expect(leitura.carregando).toBe(false);
  });

  it("assinaturas antigas de fotos não substituem as da leitura nova", async () => {
    const assinatura = pendente();
    rpc.mockResolvedValueOnce({
      data: { ...RECEBIDA, fotos: ["a.jpg"] },
      error: null,
    });
    createSignedUrl.mockReturnValueOnce(assinatura.promessa);
    let antiga!: Promise<void>;
    await act(async () => {
      antiga = leitura.recarregar();
      await Promise.resolve();
    });
    rpc.mockResolvedValueOnce({ data: CONCLUIDA, error: null });
    await act(async () => leitura.recarregar());
    await act(async () => {
      assinatura.resolver({
        data: { signedUrl: "https://foto.test/antiga" },
        error: null,
      });
      await antiga;
    });
    expect(leitura.fotos.size).toBe(0);
    expect(leitura.detalhe?.status).toBe("concluida");
    expect(leitura.carregando).toBe(false);
  });

  it("fechar a ficha invalida a leitura pendente e encerra carregando", async () => {
    const antiga = pendente();
    rpc.mockReturnValueOnce(antiga.promessa);
    let atualizacao!: Promise<void>;
    act(() => {
      atualizacao = leitura.recarregar();
    });
    await act(async () => raiz.render(<Sonda id={null} />));
    expect(leitura.carregando).toBe(false);
    await act(async () => {
      antiga.resolver({ data: RECEBIDA, error: null });
      await atualizacao;
    });
    expect(leitura.detalhe).toBeNull();
    expect(leitura.carregando).toBe(false);
  });
});
