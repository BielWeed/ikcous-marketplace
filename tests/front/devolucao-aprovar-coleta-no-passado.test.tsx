// @vitest-environment jsdom
//
// Aprovar devolução com retorno por COLETA (AcoesDaDevolucao): o "Dia e hora da
// coleta" não pode ficar no passado. Escolher 11/11 estando em 12/11 gravava
// `coleta_em` antigo, o app dizia "Devolução aprovada" e o cliente recebia
// aviso de uma coleta que já tinha passado. A tela barra antes de chamar o
// servidor; 5 minutos de folga cobrem o relógio do aparelho adiantado/atrasado.
// Coleta vazia continua valendo (a lojista combina depois): vai null.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FichaDaDevolucao } from "@/hooks/useDevolucoesAdmin";
import type { DevolucaoDetalhe } from "@/types/devolucao";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MENSAGEM_DO_PASSADO =
  "Escolha um dia e hora da coleta que ainda não passaram.";

function detalheDeColeta(): DevolucaoDetalhe {
  return {
    id: "d-1",
    protocolo: "DV261112-AAAAA",
    order_id: "o-1",
    tipo: "arrependimento",
    motivo: "tamanho_pequeno",
    detalhe: null,
    resolucao_desejada: "reembolso",
    resolucao_final: null,
    modalidade: "nacional",
    metodo_retorno: "coleta",
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
    entregue_em: "2026-11-10T15:00:00Z",
    prazo_ate: "2026-11-17",
    politica: null,
    created_at: "2026-11-12T10:00:00Z",
    aprovada_em: null,
    postada_em: null,
    recebida_em: null,
    concluida_em: null,
    encerrada_em: null,
    itens: [],
    eventos: [],
    pedido: {
      id: "o-1",
      total: 100,
      shipping: 0,
      payment_method: "online",
      payment_status: "pago",
      canal: "online",
      customer_name: "Maria Teste",
      whatsapp: "34999990000",
      shipping_label_id: null,
      shipping_option_id: null,
    },
  } as unknown as DevolucaoDetalhe;
}

const aprovar = vi.fn();
let raiz: Root;
let hospedeiro: HTMLDivElement;

// "Agora" fixo: 12/11/2026 12:00, hora do aparelho (o campo é datetime-local).
const AGORA = new Date(2026, 10, 12, 12, 0, 0);

// Formato do `datetime-local`: AAAA-MM-DDTHH:mm, na hora do aparelho.
function paraCampo(d: Date): string {
  const dois = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}T${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  rpc.mockResolvedValue({ data: null, error: null });
  aprovar.mockResolvedValue(null);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

async function drenar() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}

async function montar() {
  const { AcoesDaDevolucao } = await import(
    "@/components/admin/devolucoes/AcoesDaDevolucao"
  );
  const ficha = { emVoo: null, aprovar } as unknown as FichaDaDevolucao;
  await act(async () => {
    raiz.render(
      <AcoesDaDevolucao
        ficha={ficha}
        detalhe={detalheDeColeta()}
        onSujoMudou={vi.fn()}
      />,
    );
  });
  await drenar();
}

function botao(texto: string): HTMLButtonElement | undefined {
  return Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  );
}

async function clicar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.click();
  });
  await drenar();
}

// Abre "Aprovar", digita a coleta (ou deixa vazia) e confirma.
async function aprovarComColeta(coleta: Date | null) {
  await montar();
  await clicar(botao("Aprovar"));
  const campo = hospedeiro.querySelector<HTMLInputElement>("#devolucao-coleta");
  expect(campo).toBeTruthy();
  if (coleta) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo, paraCampo(coleta));
      campo?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      campo?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
  }
  await clicar(botao("Confirmar aprovação"));
}

const alerta = () => hospedeiro.querySelector('[role="alert"]')?.textContent;

describe("AcoesDaDevolucao — aprovar com coleta no passado", () => {
  it("coleta de ontem: mostra o aviso e NÃO aprova", async () => {
    await aprovarComColeta(new Date(2026, 10, 11, 10, 0, 0));

    expect(alerta()).toContain(MENSAGEM_DO_PASSADO);
    expect(aprovar).not.toHaveBeenCalled();
  });

  it("coleta de amanhã: aprova com o instante em ISO e sem aviso", async () => {
    const amanha = new Date(2026, 10, 13, 10, 0, 0);
    await aprovarComColeta(amanha);

    expect(alerta()).toBeUndefined();
    expect(aprovar).toHaveBeenCalledExactlyOnceWith({
      mensagem: "",
      coletaEm: amanha.toISOString(),
    });
  });

  it("coleta vazia: aprova com coletaEm nulo, como antes", async () => {
    await aprovarComColeta(null);

    expect(alerta()).toBeUndefined();
    expect(aprovar).toHaveBeenCalledExactlyOnceWith({
      mensagem: "",
      coletaEm: null,
    });
  });

  it("coleta 2 minutos atrás: dentro da folga do relógio, aprova", async () => {
    const haDoisMinutos = new Date(2026, 10, 12, 11, 58, 0);
    await aprovarComColeta(haDoisMinutos);

    expect(alerta()).toBeUndefined();
    expect(aprovar).toHaveBeenCalledExactlyOnceWith({
      mensagem: "",
      coletaEm: haDoisMinutos.toISOString(),
    });
  });
});
