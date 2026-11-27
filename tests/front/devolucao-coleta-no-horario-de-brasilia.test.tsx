// @vitest-environment jsdom
//
// O "Dia e hora da coleta" que a lojista marca ao aprovar a devolução é horário
// de BRASÍLIA, nunca o do aparelho. Antes (27/11/2026) o campo `datetime-local`
// era lido com `new Date(valor)`, no fuso do computador: num aparelho em UTC, a
// lojista marcava 28/11 10:00 e gravava 10:00 UTC, que a cliente via como
// 07:00 (DetalheDaDevolucao e o aviso da devolução mostram em Brasília). E a
// trava "já passou" media contra o relógio errado: 13:00 de hoje em Brasília,
// ainda por vir, era barrado como passado.
//
// As provas trocam o fuso do processo (`process.env.TZ`, que o Node relê na
// hora) e afirmam INSTANTES LITERAIS em UTC escritos à mão, como os testes do
// banner (`banner-horario-de-brasilia-em-qualquer-fuso.test.ts`). O fuso volta
// ao que era depois de cada teste (no Windows, apagar `TZ` não devolve o da
// máquina).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FichaDaDevolucao } from "@/hooks/useDevolucoesAdmin";
import type { DevolucaoDetalhe } from "@/types/devolucao";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fusoDaMaquina =
  process.env.TZ ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;

// "Agora": 27/11/2026 12:00 em Brasília (15:00 UTC).
const AGORA = new Date("2026-11-27T15:00:00.000Z");

function detalheDeColeta(): DevolucaoDetalhe {
  return {
    id: "d-1",
    protocolo: "DV261127-AAAAA",
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
    entregue_em: "2026-11-25T15:00:00Z",
    prazo_ate: "2026-12-02",
    politica: null,
    created_at: "2026-11-27T10:00:00Z",
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
  process.env.TZ = fusoDaMaquina;
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

/** O gesto inteiro de um toque, como o celular manda dentro da folha. */
async function tocar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    el?.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, cancelable: true }),
    );
    el?.click();
  });
  await drenar();
}

/** Abre "Aprovar", digita a coleta, sai do campo e confirma. */
async function aprovarComColeta(valorDoCampo: string) {
  await montar();
  await tocar(botao("Aprovar"));
  const campo = hospedeiro.querySelector<HTMLInputElement>("#devolucao-coleta");
  expect(campo).toBeTruthy();
  await act(async () => {
    campo?.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, valorDoCampo);
    campo?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => campo?.blur());
  await drenar();
  await tocar(botao("Confirmar aprovação"));
}

const alerta = () =>
  hospedeiro.querySelector('[role="alert"]')?.textContent ?? null;

const PASSOU = "Escolha um dia e hora da coleta que ainda não passaram.";

describe.each([
  "UTC", // o CI, e computador com fuso de fábrica
  "Asia/Tokyo", // +09:00
  "America/Sao_Paulo", // controle: a loja
])("coleta da devolução, aparelho em %s", (fuso) => {
  beforeEach(() => {
    process.env.TZ = fuso;
  });

  it("28/11 10:00 digitado é 10:00 de Brasília (13:00 UTC)", async () => {
    await aprovarComColeta("2026-11-28T10:00");

    expect(alerta()).toBeNull();
    expect(aprovar).toHaveBeenCalledExactlyOnceWith({
      mensagem: "",
      coletaEm: "2026-11-28T13:00:00.000Z",
    });
  });

  it("13:00 de hoje em Brasília ainda não passou: aprova", async () => {
    await aprovarComColeta("2026-11-27T13:00");

    expect(alerta()).toBeNull();
    expect(aprovar).toHaveBeenCalledExactlyOnceWith({
      mensagem: "",
      coletaEm: "2026-11-27T16:00:00.000Z",
    });
  });

  it("folga de 5 minutos medida em Brasília: 11:55 vale, 11:54 já passou", async () => {
    await aprovarComColeta("2026-11-27T11:55");
    expect(alerta()).toBeNull();
    expect(aprovar).toHaveBeenCalledExactlyOnceWith({
      mensagem: "",
      coletaEm: "2026-11-27T14:55:00.000Z",
    });

    aprovar.mockClear();
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await aprovarComColeta("2026-11-27T11:54");
    expect(alerta()).toBe(PASSOU);
    expect(aprovar).not.toHaveBeenCalled();
  });

  it("valor que não se lê como horário de Brasília: avisa e NÃO aprova", async () => {
    // O jsdom aceita frações de segundo no `datetime-local`; a leitura em
    // Brasília só aceita até os segundos e devolve null.
    await aprovarComColeta("2026-11-28T10:00:00.5");

    expect(alerta()).toBe(
      "Não deu para ler o dia e hora da coleta. Escolha de novo no calendário.",
    );
    expect(aprovar).not.toHaveBeenCalled();
  });
});

it("o rótulo diz que a hora da coleta é a de Brasília", async () => {
  await montar();
  await tocar(botao("Aprovar"));
  const rotulo = hospedeiro.querySelector('label[for="devolucao-coleta"]');
  expect(rotulo?.textContent?.trim()).toBe(
    "Dia e hora da coleta (horário de Brasília)",
  );
});
