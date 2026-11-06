// @vitest-environment jsdom
//
// useDevolucaoCliente — o contrato com o banco: a foto sobe no bucket
// PRIVADO `devolucoes` na pasta do próprio usuário (`<uid>/<pedido>/…`, a
// única que a policy deixa gravar), `solicitar_devolucao` recebe os
// argumentos com os nomes da migration e a recusa do servidor volta como
// veio. Desligado (pedido não entregue / convidado), não pergunta nada.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DevolucaoDoCliente } from "@/hooks/useDevolucaoCliente";

const { rpc, upload, remove, from } = vi.hoisted(() => {
  const upload = vi.fn();
  const remove = vi.fn();
  return {
    rpc: vi.fn(),
    upload,
    remove,
    from: vi.fn(() => ({ upload, remove })),
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc, storage: { from } },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const raizes: Array<{ unmount: () => void }> = [];

async function montarSonda(habilitado: boolean) {
  const { useDevolucaoCliente } = await import("@/hooks/useDevolucaoCliente");
  const leituras: DevolucaoDoCliente[] = [];
  function Sonda() {
    leituras.push(useDevolucaoCliente("o-1", habilitado));
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  raizes.push(root);
  await act(async () => {
    root.render(createElement(Sonda));
  });
  await act(async () => {});
  return () => leituras[leituras.length - 1];
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: null, error: null });
  upload.mockResolvedValue({ data: { path: "x" }, error: null });
  remove.mockResolvedValue({ data: [], error: null });
  vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
});

afterEach(() => {
  for (const raiz of raizes.splice(0)) act(() => raiz.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("useDevolucaoCliente", () => {
  it("desligado não pergunta nada ao servidor", async () => {
    await montarSonda(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a foto sobe no bucket privado, na pasta do usuário", async () => {
    const atual = await montarSonda(false);
    const arquivo = new File(["x"], "f.jpg", { type: "image/jpeg" });

    let desfecho: unknown;
    await act(async () => {
      desfecho = await atual().enviarFoto(arquivo, "u-1");
    });

    expect(from).toHaveBeenCalledWith("devolucoes");
    expect(upload).toHaveBeenCalledWith("u-1/o-1/uuid-1.jpg", arquivo, {
      contentType: "image/jpeg",
      upsert: false,
    });
    expect(desfecho).toEqual({ ok: true, valor: "u-1/o-1/uuid-1.jpg" });
  });

  it("descartarFotos apaga do bucket privado só os caminhos pedidos", async () => {
    const atual = await montarSonda(false);
    await act(async () => {
      await atual().descartarFotos(["u-1/o-1/a.jpg", "u-1/o-1/b.png"]);
    });
    expect(from).toHaveBeenCalledWith("devolucoes");
    expect(remove).toHaveBeenCalledWith(["u-1/o-1/a.jpg", "u-1/o-1/b.png"]);
  });

  it("descartarFotos sem caminho não chama o Storage, e uma falha dele nunca estoura", async () => {
    const atual = await montarSonda(false);
    await act(async () => {
      await atual().descartarFotos([]);
    });
    expect(remove).not.toHaveBeenCalled();

    remove.mockRejectedValueOnce(new Error("rede"));
    await act(async () => {
      await expect(atual().descartarFotos(["u-1/o-1/a.jpg"])).resolves.toBe(
        undefined,
      );
    });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("formato fora do bucket (ex.: HEIC) é recusado antes de subir", async () => {
    const atual = await montarSonda(false);
    let desfecho: unknown;
    await act(async () => {
      desfecho = await atual().enviarFoto(
        new File(["x"], "f.heic", { type: "image/heic" }),
        "u-1",
      );
    });
    expect(upload).not.toHaveBeenCalled();
    expect(desfecho).toEqual({
      ok: false,
      erro: "Envie fotos em JPG, PNG ou WEBP.",
    });
  });

  it("solicitar_devolucao recebe os argumentos da migration; a recusa volta como veio", async () => {
    const atual = await montarSonda(false);
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "Envie ao menos uma foto do problema no produto." },
    });

    let desfecho: unknown;
    await act(async () => {
      desfecho = await atual().solicitar({
        itens: [{ order_item_id: "oi-1", quantidade: 1 }],
        motivo: "defeito",
        detalhe: "   ",
        resolucao: "troca",
        metodo: "envio_proprio",
        fotos: [],
      });
    });

    expect(rpc).toHaveBeenCalledWith("solicitar_devolucao", {
      p_order_id: "o-1",
      p_itens: [{ order_item_id: "oi-1", quantidade: 1 }],
      p_motivo: "defeito",
      p_detalhe: null,
      p_resolucao: "troca",
      p_metodo: "envio_proprio",
      p_fotos: [],
    });
    expect(desfecho).toEqual({
      ok: false,
      erro: "Envie ao menos uma foto do problema no produto.",
    });
  });

  it("forma inesperada da elegibilidade é erro, nunca 'sem devolução'", async () => {
    rpc.mockImplementation((nome: string) =>
      Promise.resolve(
        nome === "devolucao_elegibilidade"
          ? { data: { qualquer: 1 }, error: null }
          : { data: [], error: null },
      ),
    );
    const atual = await montarSonda(true);
    expect(atual().erro).toBe(true);
    expect(atual().elegibilidade).toBeNull();
  });

  describe("o cartão se mantém em dia", () => {
    const POLITICA = {
      prazo_arrependimento_dias: 7,
      prazo_troca_dias: 30,
      prazo_vicio_dias: 90,
    };
    const ELEGIBILIDADE = {
      pode: false,
      modalidade: "nacional",
      janelas: {},
      itens: [],
      politica: POLITICA,
    };

    // Servidor de mentira: o status da devolução é do SERVIDOR, e muda sem a
    // tela saber (a loja cancelou/recebeu enquanto a ficha estava aberta).
    const servidor = { status: "aprovada" };
    const chamadas = (nome: string) =>
      rpc.mock.calls.filter(([n]) => n === nome).length;

    function ligarServidor(
      acoes: Record<string, () => { data: unknown; error: unknown }> = {},
    ) {
      const porNome = new Map(Object.entries(acoes));
      rpc.mockImplementation((nome: string) => {
        const acao = porNome.get(nome);
        if (acao) return Promise.resolve(acao());
        if (nome === "devolucao_elegibilidade") {
          return Promise.resolve({ data: ELEGIBILIDADE, error: null });
        }
        if (nome === "devolucoes_do_pedido") {
          return Promise.resolve({
            data: [
              {
                id: "d-1",
                protocolo: "DV1",
                status: servidor.status,
                tipo: "arrependimento",
                resolucao_desejada: "reembolso",
                metodo_retorno: "envio_proprio",
              },
            ],
            error: null,
          });
        }
        if (nome === "devolucao_detalhe") {
          return Promise.resolve({
            data: {
              id: "d-1",
              protocolo: "DV1",
              order_id: "o-1",
              tipo: "arrependimento",
              motivo: "desisti",
              resolucao_desejada: "reembolso",
              modalidade: "nacional",
              metodo_retorno: "envio_proprio",
              status: servidor.status,
              itens: [],
            },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });
    }

    const mudarVisibilidade = (estado: "visible" | "hidden") => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => estado,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    };

    beforeEach(() => {
      servidor.status = "aprovada";
    });

    afterEach(() => {
      Reflect.deleteProperty(document, "visibilityState");
    });

    it("cancelar que o servidor recusa (já cancelada pela loja) relê o cartão e mantém a mensagem do servidor", async () => {
      ligarServidor({
        cancelar_devolucao: () => {
          // Quando a cliente toca em cancelar, a loja já tinha cancelado.
          servidor.status = "cancelada";
          return {
            data: null,
            error: { message: "Esta devolução não pode mais ser cancelada." },
          };
        },
      });
      const atual = await montarSonda(true);
      expect(atual().atual?.status).toBe("aprovada");
      expect(chamadas("devolucao_elegibilidade")).toBe(1);

      let desfecho: unknown;
      await act(async () => {
        desfecho = await atual().cancelar("d-1");
      });

      expect(desfecho).toEqual({
        ok: false,
        erro: "Esta devolução não pode mais ser cancelada.",
      });
      expect(chamadas("devolucao_elegibilidade")).toBe(2);
      expect(atual().atual?.status).toBe("cancelada");
    });

    it("informar envio que o servidor recusa também relê o cartão", async () => {
      ligarServidor({
        informar_envio_devolucao: () => {
          servidor.status = "cancelada";
          return {
            data: null,
            error: { message: "A devolução não está aguardando envio." },
          };
        },
      });
      const atual = await montarSonda(true);

      let desfecho: unknown;
      await act(async () => {
        desfecho = await atual().informarEnvio("d-1", "AB123456789BR");
      });

      expect(desfecho).toEqual({
        ok: false,
        erro: "A devolução não está aguardando envio.",
      });
      expect(chamadas("devolucao_elegibilidade")).toBe(2);
      expect(atual().atual?.status).toBe("cancelada");
    });

    it("se a releitura depois do erro também falha, a mensagem do servidor continua sendo a devolvida", async () => {
      let lidas = 0;
      ligarServidor({
        devolucao_elegibilidade: () => {
          lidas += 1;
          return lidas === 1
            ? { data: ELEGIBILIDADE, error: null }
            : { data: null, error: { message: "rede" } };
        },
        cancelar_devolucao: () => ({
          data: null,
          error: { message: "Não foi possível cancelar agora." },
        }),
      });
      const atual = await montarSonda(true);

      let desfecho: unknown;
      await act(async () => {
        desfecho = await atual().cancelar("d-1");
      });

      expect(desfecho).toEqual({
        ok: false,
        erro: "Não foi possível cancelar agora.",
      });
    });

    it("ao voltar ao app (aba visível) relê; com a aba escondida não", async () => {
      ligarServidor();
      const atual = await montarSonda(true);
      expect(chamadas("devolucao_elegibilidade")).toBe(1);

      await act(async () => {
        mudarVisibilidade("hidden");
      });
      expect(chamadas("devolucao_elegibilidade")).toBe(1);

      servidor.status = "em_transito";
      await act(async () => {
        mudarVisibilidade("visible");
      });
      expect(chamadas("devolucao_elegibilidade")).toBe(2);
      expect(atual().atual?.status).toBe("em_transito");
    });

    it("ao voltar a conexão (evento online) relê", async () => {
      ligarServidor();
      await montarSonda(true);
      await act(async () => {
        window.dispatchEvent(new Event("online"));
      });
      expect(chamadas("devolucao_elegibilidade")).toBe(2);
    });

    it("desligado (convidado/não entregue) não relê ao voltar ao app", async () => {
      ligarServidor();
      await montarSonda(false);
      await act(async () => {
        mudarVisibilidade("visible");
        window.dispatchEvent(new Event("online"));
      });
      expect(rpc).not.toHaveBeenCalled();
    });

    it("depois de desmontar, voltar ao app não relê mais (ouvintes removidos)", async () => {
      ligarServidor();
      await montarSonda(true);
      for (const raiz of raizes.splice(0)) act(() => raiz.unmount());
      const antes = chamadas("devolucao_elegibilidade");
      await act(async () => {
        mudarVisibilidade("visible");
        window.dispatchEvent(new Event("online"));
      });
      expect(chamadas("devolucao_elegibilidade")).toBe(antes);
    });
  });
});
