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

const { rpc, upload, from } = vi.hoisted(() => {
  const upload = vi.fn();
  return {
    rpc: vi.fn(),
    upload,
    from: vi.fn(() => ({ upload })),
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
});
