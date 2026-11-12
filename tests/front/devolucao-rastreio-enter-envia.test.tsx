// @vitest-environment jsdom
//
// O campo do código de rastreio da devolução por envio próprio fica dentro de um
// <form>: apertar Enter no teclado do celular envia o código, igual ao botão
// "Enviar", e nunca duas vezes (o botão é o submit, sem onClick próprio).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DevolucaoDetalhe } from "@/types/devolucao";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

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

const devolucao = {
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
  prazo_ate: "2026-10-30",
  politica: null,
  created_at: "2026-10-20T12:00:00Z",
  aprovada_em: "2026-10-21T12:00:00Z",
  postada_em: null,
  recebida_em: null,
  concluida_em: null,
  encerrada_em: null,
  itens: [
    { id: "i-1", quantidade: 1, valor_unitario: 100, product_name: "Tênis" },
  ],
  eventos: [],
  pedido: null,
} as unknown as DevolucaoDetalhe;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
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
  onInformarEnvio = vi.fn().mockResolvedValue({ ok: true }),
) {
  const { DevolucaoDoPedidoCard } = await import(
    "@/components/devolucao/DevolucaoDoPedidoCard"
  );
  await act(async () => {
    raiz.render(
      <DevolucaoDoPedidoCard
        atual={devolucao}
        anteriores={[]}
        enderecoDaLoja={null}
        horarioDaLoja={null}
        onCancelar={vi.fn()}
        onInformarEnvio={onInformarEnvio}
      />,
    );
  });
  return onInformarEnvio;
}

async function digitar(texto: string) {
  const campo = document.querySelector<HTMLInputElement>(
    "#rastreio-devolucao-d-1",
  ) as HTMLInputElement;
  expect(campo).toBeTruthy();
  await act(async () => {
    // Setter nativo: o React só vê a mudança de um input controlado assim.
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return campo;
}

const esvaziar = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("cartão da devolução — Enter no campo do código de rastreio", () => {
  it("o campo e o botão 'Enviar' moram no mesmo <form>, e o botão é o submit", async () => {
    await montar();
    const campo = document.querySelector("#rastreio-devolucao-d-1");
    const form = campo?.closest("form");
    expect(form).toBeTruthy();
    const enviar = Array.from(form?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent?.trim() === "Enviar",
    );
    expect(enviar?.getAttribute("type")).toBe("submit");
  });

  it("enviar o formulário (Enter) manda o código UMA vez", async () => {
    const onInformarEnvio = await montar();
    const campo = await digitar("ab123456789br");
    const form = campo.closest("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await esvaziar();
    });
    expect(onInformarEnvio).toHaveBeenCalledTimes(1);
    expect(onInformarEnvio).toHaveBeenCalledWith("d-1", "AB123456789BR");
  });

  it("clicar no botão 'Enviar' também manda UMA vez só", async () => {
    const onInformarEnvio = await montar();
    await digitar("AB123456789BR");
    const enviar = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Enviar",
    );
    await act(async () => {
      enviar?.click();
      await esvaziar();
    });
    expect(onInformarEnvio).toHaveBeenCalledTimes(1);
  });

  it("durante o envio o botão fica desabilitado e um segundo submit não duplica", async () => {
    let terminar: (v: { ok: true }) => void = () => {};
    const onInformarEnvio = vi.fn(
      () =>
        new Promise<{ ok: true }>((r) => {
          terminar = r;
        }),
    );
    await montar(onInformarEnvio);
    const campo = await digitar("AB123456789BR");
    const form = campo.closest("form") as HTMLFormElement;
    const submeter = () =>
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    await act(async () => {
      submeter();
      await esvaziar();
    });
    const enviar = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Enviar",
    ) as HTMLButtonElement;
    expect(enviar.disabled).toBe(true);
    await act(async () => {
      submeter();
      await esvaziar();
    });
    expect(onInformarEnvio).toHaveBeenCalledTimes(1);
    await act(async () => {
      terminar({ ok: true });
      await esvaziar();
    });
  });

  it("Enter com o campo vazio não envia e mostra o aviso de código", async () => {
    const onInformarEnvio = await montar();
    const campo = document.querySelector(
      "#rastreio-devolucao-d-1",
    ) as HTMLInputElement;
    await act(async () => {
      campo
        .closest("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      await esvaziar();
    });
    expect(onInformarEnvio).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Digite o código de rastreio",
    );
  });
});
