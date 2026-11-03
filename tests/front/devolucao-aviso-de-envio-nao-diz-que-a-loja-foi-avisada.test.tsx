// @vitest-environment jsdom
//
// Caça 03/11, achado f8: depois de informar a postagem, o cartão da devolução
// dizia "A loja foi avisada". Nada avisa a loja: `informar_envio_devolucao` só
// muda o status para `em_transito` e grava o evento (sem push, sem aviso, e o
// sino do painel conta só `solicitada`). O que é verdade: a devolução passa a
// aparecer como "A caminho" na lista de Devoluções do painel.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Desfecho } from "@/hooks/useDevolucaoCliente";
import type { DevolucaoDetalhe } from "@/types/devolucao";

const { toast } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({ toast }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function devolucaoDe(over: Record<string, unknown> = {}) {
  return {
    id: "d-1",
    protocolo: "DV1",
    order_id: "o-1",
    tipo: "arrependimento",
    motivo: "desisti",
    detalhe: null,
    resolucao_desejada: "reembolso",
    resolucao_final: null,
    modalidade: "nacional",
    metodo_retorno: "envio_proprio",
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
    entregue_em: null,
    prazo_ate: "2026-11-10",
    politica: null,
    created_at: "2026-11-01T12:00:00Z",
    aprovada_em: "2026-11-02T12:00:00Z",
    postada_em: null,
    recebida_em: null,
    concluida_em: null,
    encerrada_em: null,
    itens: [
      { id: "i-1", quantidade: 1, valor_unitario: 100, product_name: "Tênis" },
    ],
    eventos: [],
    pedido: null,
    ...over,
  } as unknown as DevolucaoDetalhe;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

async function montar(
  atual: DevolucaoDetalhe,
  onInformarEnvio: (id: string, codigo: string) => Promise<Desfecho>,
) {
  const { DevolucaoDoPedidoCard } = await import(
    "@/components/devolucao/DevolucaoDoPedidoCard"
  );
  await act(async () => {
    raiz.render(
      <DevolucaoDoPedidoCard
        atual={atual}
        anteriores={[]}
        enderecoDaLoja={null}
        horarioDaLoja={null}
        onCancelar={vi.fn()}
        onInformarEnvio={onInformarEnvio}
      />,
    );
  });
}

async function clicarEmBotao(texto: string) {
  const alvo = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  );
  expect(alvo).toBeTruthy();
  await act(async () => {
    alvo?.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

async function digitar(texto: string) {
  const campo = document.querySelector<HTMLInputElement>(
    "#rastreio-devolucao-d-1",
  );
  expect(campo).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, texto);
    campo?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const textoDoSucesso = () => String(toast.success.mock.calls[0]?.[0] ?? "");

describe("cartão da devolução — aviso depois de informar a postagem", () => {
  it("envio próprio: o aviso de sucesso não afirma que a loja foi avisada", async () => {
    const onInformarEnvio = vi.fn().mockResolvedValue({ ok: true });
    await montar(devolucaoDe(), onInformarEnvio);
    await digitar("ab123456789br");
    await clicarEmBotao("Enviar");

    expect(onInformarEnvio).toHaveBeenCalledWith("d-1", "AB123456789BR");
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(textoDoSucesso()).not.toMatch(/avisada/i);
    // O que é verdade: a loja vê o andamento na lista de Devoluções.
    expect(textoDoSucesso()).toContain("Devoluções");
  });

  it("etiqueta reversa ('Já postei o pacote'): mesmo aviso, sem afirmar que a loja foi avisada", async () => {
    const onInformarEnvio = vi.fn().mockResolvedValue({ ok: true });
    await montar(
      devolucaoDe({
        metodo_retorno: "etiqueta_reversa",
        codigo_postagem: "PP123456789BR",
      }),
      onInformarEnvio,
    );
    await clicarEmBotao("Já postei o pacote");

    expect(onInformarEnvio).toHaveBeenCalledWith("d-1", "PP123456789BR");
    expect(textoDoSucesso()).not.toMatch(/avisada/i);
    expect(textoDoSucesso()).toContain("Devoluções");
  });

  it("borda: se o servidor recusa, não aparece aviso de sucesso nenhum", async () => {
    const onInformarEnvio = vi
      .fn()
      .mockResolvedValue({ ok: false, erro: "Código de rastreio inválido." });
    await montar(devolucaoDe(), onInformarEnvio);
    await digitar("ab123456789br");
    await clicarEmBotao("Enviar");

    expect(toast.success).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Código de rastreio inválido.",
    );
  });
});
