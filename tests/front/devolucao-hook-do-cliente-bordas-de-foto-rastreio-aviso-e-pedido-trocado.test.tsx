// @vitest-environment jsdom
//
// Bordas do hook da devolução do cliente (useDevolucaoCliente) que a mutação
// achou sem teste:
//  - sem aviso novo no sino a tela NÃO fica "aguardando aviso" (senão o aviso
//    do pedido nunca seria marcado como lido);
//  - o código de rastreio vai ao servidor sem espaços nas pontas;
//  - a foto de exatamente 5 MB passa e a de 5 MB mais 1 byte é recusada;
//  - com mais de uma devolução no pedido, a ficha aberta é a mais recente (a
//    primeira da lista, que o servidor ordena do mais novo para o mais velho);
//  - uma ação que termina DEPOIS de a cliente trocar de pedido não relê o
//    pedido antigo por cima da leitura do pedido novo.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type DadosDaSolicitacao,
  type DevolucaoDoCliente,
  useDevolucaoCliente,
} from "@/hooks/useDevolucaoCliente";

const { rpc, upload, remove, redimensionar } = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  redimensionar: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc, storage: { from: () => ({ upload, remove }) } },
}));
vi.mock("@/lib/redimensiona-imagem", () => ({
  redimensionarImagem: redimensionar,
}));

type Resposta = { data: unknown; error: unknown };
function pendente() {
  let resolver!: (resposta: Resposta) => void;
  const promessa = new Promise<Resposta>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

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
const elegibilidadeDe = (diasDesdeAEntrega: number) => ({
  pode: true,
  motivo_bloqueio: null,
  entregue_em: "2026-10-15T10:00:00Z",
  dias_desde_entrega: diasDesdeAEntrega,
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
});

const resumoDe = (id: string, protocolo: string) => ({
  id,
  protocolo,
  status: "aprovada",
  tipo: "arrependimento",
  resolucao_desejada: "troca",
  metodo_retorno: "entrega_na_loja",
  valor_itens: 100,
  created_at: "2026-10-16T10:00:00Z",
});

const detalheDe = (id: string, protocolo: string) => ({
  ...resumoDe(id, protocolo),
  order_id: "pedido-a",
  motivo: "tamanho_pequeno",
  detalhe: null,
  resolucao_final: null,
  modalidade: "local",
  valor_frete_ida: 0,
  valor_reembolso: null,
  refund_id: null,
  reembolso_manual: false,
  fotos: [],
  prazo_ate: "2026-10-22",
  politica: POLITICA,
  itens: [],
  eventos: [],
  pedido: null,
});

const DADOS: DadosDaSolicitacao = {
  itens: [{ order_item_id: "oi-1", quantidade: 1 }],
  motivo: "desisti",
  detalhe: "",
  resolucao: "reembolso",
  metodo: "envio_proprio",
  fotos: [],
};

let raiz: Root;
let hospedeiro: HTMLDivElement;
let leitura: DevolucaoDoCliente;

function Sonda({ id }: { id: string }) {
  const lida = useDevolucaoCliente(id, true);
  useEffect(() => {
    leitura = lida;
  });
  return null;
}

async function renderizar(id: string) {
  await act(async () => raiz.render(<Sonda id={id} />));
}

// Respostas por RPC e por pedido; `pedido-b` pode ficar pendurado.
function responder(porPedido: Record<string, number>) {
  rpc.mockImplementation((nome: string, args?: { p_order_id?: string }) => {
    if (nome === "solicitar_devolucao") {
      return Promise.resolve({
        data: {
          id: "dev-novo",
          protocolo: "DV1",
          tipo: "arrependimento",
          status: "solicitada",
        },
        error: null,
      });
    }
    if (nome === "informar_envio_devolucao") {
      return Promise.resolve({
        data: { id: "dev-1", status: "em_transito" },
        error: null,
      });
    }
    const dias = porPedido[args?.p_order_id ?? ""] ?? 1;
    return Promise.resolve({
      data: nome === "devolucao_elegibilidade" ? elegibilidadeDe(dias) : [],
      error: null,
    });
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  upload.mockResolvedValue({ error: null });
  remove.mockResolvedValue({ error: null });
  responder({ "pedido-a": 1 });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

describe("useDevolucaoCliente — bordas", () => {
  it("sem aviso novo no sino, depois de ler, não fica aguardando aviso", async () => {
    await renderizar("pedido-a");
    expect(leitura.elegibilidade?.pode).toBe(true);
    expect(leitura.aguardandoAviso).toBe(false);
  });

  it("o código de rastreio vai ao servidor sem espaços nas pontas", async () => {
    await renderizar("pedido-a");
    let desfecho: Awaited<ReturnType<typeof leitura.informarEnvio>> | undefined;
    await act(async () => {
      desfecho = await leitura.informarEnvio("dev-1", "  AB123456789BR \n");
    });
    expect(desfecho).toEqual({ ok: true, valor: undefined });
    expect(rpc).toHaveBeenCalledWith("informar_envio_devolucao", {
      p_id: "dev-1",
      p_codigo_rastreio: "AB123456789BR",
    });
  });

  describe("foto: o limite de 5 MB", () => {
    const CINCO_MB = 5 * 1024 * 1024;
    const arquivo = () =>
      new File(["x"], "defeito.jpg", { type: "image/jpeg" });

    async function enviarComTamanho(tamanho: number) {
      redimensionar.mockResolvedValue({ size: tamanho, type: "image/jpeg" });
      await renderizar("pedido-a");
      let desfecho: Awaited<ReturnType<typeof leitura.enviarFoto>> | undefined;
      await act(async () => {
        desfecho = await leitura.enviarFoto(arquivo(), "u-1");
      });
      return desfecho;
    }

    it("exatamente 5 MB ainda sobe", async () => {
      const desfecho = await enviarComTamanho(CINCO_MB);
      expect(desfecho?.ok).toBe(true);
      expect(upload).toHaveBeenCalledTimes(1);
    });

    it("5 MB mais 1 byte é recusada sem subir", async () => {
      const desfecho = await enviarComTamanho(CINCO_MB + 1);
      expect(desfecho).toEqual({
        ok: false,
        erro: "A foto passa de 5 MB. Escolha uma menor.",
      });
      expect(upload).not.toHaveBeenCalled();
    });
  });

  it("com duas devoluções no pedido, abre a ficha da mais recente (a primeira da lista)", async () => {
    rpc.mockImplementation((nome: string) =>
      Promise.resolve({
        data:
          nome === "devolucao_elegibilidade"
            ? elegibilidadeDe(1)
            : nome === "devolucoes_do_pedido"
              ? [
                  resumoDe("dev-recente", "DV-NOVA"),
                  resumoDe("dev-antiga", "DV-VELHA"),
                ]
              : detalheDe("dev-recente", "DV-NOVA"),
        error: null,
      }),
    );
    await renderizar("pedido-a");

    expect(rpc).toHaveBeenCalledWith("devolucao_detalhe", {
      p_id: "dev-recente",
    });
    expect(leitura.atual?.protocolo).toBe("DV-NOVA");
    expect(leitura.devolucoes.map((d) => d.protocolo)).toEqual([
      "DV-NOVA",
      "DV-VELHA",
    ]);
  });

  it("ação do pedido antigo que termina depois da troca não apaga a leitura do pedido novo", async () => {
    responder({ "pedido-a": 1, "pedido-b": 5 });
    await renderizar("pedido-a");
    expect(leitura.elegibilidade?.dias_desde_entrega).toBe(1);
    const solicitarDoPedidoA = leitura.solicitar;

    // O pedido B começa a ler e fica esperando a rede.
    const elegibilidadeB = pendente();
    const listaB = pendente();
    const respostaDeA = rpc.getMockImplementation();
    rpc.mockImplementation((nome: string, args?: { p_order_id?: string }) => {
      if (args?.p_order_id === "pedido-b") {
        return nome === "devolucao_elegibilidade"
          ? elegibilidadeB.promessa
          : listaB.promessa;
      }
      return respostaDeA?.(nome, args);
    });
    await renderizar("pedido-b");

    // A solicitação do pedido A (tela antiga) termina agora e pede a releitura.
    await act(async () => {
      await solicitarDoPedidoA(DADOS);
    });

    await act(async () => {
      elegibilidadeB.resolver({ data: elegibilidadeDe(5), error: null });
      listaB.resolver({ data: [], error: null });
    });
    expect(leitura.elegibilidade?.dias_desde_entrega).toBe(5);
    expect(leitura.erro).toBe(false);
  });
});
