// @vitest-environment jsdom
//
// Fechar a folha de devolução/troca apagava TUDO o que a cliente tinha
// preenchido (itens, motivo, texto, fotos) sem perguntar: o conteúdo da folha
// é desmontado ao fechar, por toque fora, Esc ou o X. Agora, havendo algo
// preenchido, fechar pede confirmação ("Descartar o que você preencheu?"); sem
// nada preenchido, fecha direto, como sempre.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ElegibilidadeDevolucao } from "@/types/devolucao";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ELEGIBILIDADE: ElegibilidadeDevolucao = {
  pode: true,
  motivo_bloqueio: null,
  entregue_em: "2026-09-24T15:00:00Z",
  dias_desde_entrega: 2,
  modalidade: "nacional",
  metodos: ["etiqueta_reversa", "envio_proprio"],
  prazos: {
    arrependimento_ate: "2026-10-01",
    troca_ate: "2026-10-24",
    vicio_ate: "2026-12-23",
  },
  janelas: { arrependimento: true, troca: true, vicio: true },
  itens: [
    {
      order_item_id: "oi-1",
      product_id: "p-1",
      product_name: "Tênis",
      image_url: null,
      quantidade: 2,
      ja_devolvida: 0,
      disponivel: 2,
      valor_unitario: 100,
    },
  ],
  politica: {
    prazo_arrependimento_dias: 7,
    prazo_troca_dias: 30,
    prazo_vicio_dias: 90,
    aceita_troca: true,
    aceita_vale: true,
    exige_fotos_vicio: true,
    metodos_locais: ["entrega_na_loja", "coleta"],
    metodos_nacionais: ["etiqueta_reversa", "envio_proprio"],
    reembolso_momento: "ao_receber",
    frete_troca_pago_por: "cliente",
    categorias_sem_troca: [],
    texto_politica: "Trocas em até 30 dias, com etiqueta.",
    endereco_devolucao: null,
    updated_at: null,
  },
};

const solicitar = vi.fn();
const enviarFoto = vi.fn();
const onAbertoMudou = vi.fn();

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  solicitar.mockReset();
  enviarFoto.mockReset();
  onAbertoMudou.mockReset();
  solicitar.mockResolvedValue({
    ok: true,
    valor: {
      id: "d-1",
      protocolo: "DV260926-ABCDE",
      tipo: "arrependimento",
      status: "solicitada",
    },
  });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

async function montar() {
  const { SolicitarDevolucaoSheet } = await import(
    "@/components/devolucao/SolicitarDevolucaoSheet"
  );
  await act(async () => {
    raiz.render(
      <SolicitarDevolucaoSheet
        aberto
        onAbertoMudou={onAbertoMudou}
        elegibilidade={ELEGIBILIDADE}
        userId="u-1"
        enderecoDaLoja="Rua A, 10"
        horarioDaLoja="Seg a Sex, 9h às 18h"
        solicitar={solicitar}
        enviarFoto={enviarFoto}
      />,
    );
  });
}

const folha = () =>
  document.querySelector<HTMLElement>('[data-testid="folha-devolucao"]');
const aviso = () => document.querySelector<HTMLElement>('[role="alertdialog"]');

function botao(
  texto: string,
  dentro: ParentNode | null | undefined = document,
): HTMLButtonElement | undefined {
  return Array.from(dentro?.querySelectorAll("button") ?? []).find(
    (b) =>
      b.textContent?.trim() === texto || b.getAttribute("aria-label") === texto,
  );
}

async function clicar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

async function apertarEsc() {
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

const fecharPeloX = () => clicar(botao("Close", folha()));

async function escolherFoto() {
  const entrada = folha()?.querySelector<HTMLInputElement>(
    '[data-testid="entrada-fotos-devolucao"]',
  );
  expect(entrada).toBeTruthy();
  const arquivo = new File(["x"], "foto.jpg", { type: "image/jpeg" });
  Object.defineProperty(entrada, "files", {
    configurable: true,
    value: [arquivo],
  });
  await act(async () => {
    entrada?.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const radio = (valor: string) =>
  folha()?.querySelector<HTMLInputElement>(
    `input[type="radio"][value="${valor}"]`,
  );

describe("SolicitarDevolucaoSheet — fechar não joga fora o que foi preenchido", () => {
  it("nada preenchido: o X fecha direto, sem pergunta", async () => {
    await montar();
    await fecharPeloX();

    expect(onAbertoMudou).toHaveBeenCalledWith(false);
    expect(aviso()).toBeNull();
  });

  it("item marcado: o X pergunta antes e não fecha", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis", folha()));
    await fecharPeloX();

    expect(onAbertoMudou).not.toHaveBeenCalled();
    expect(aviso()?.textContent).toContain("Descartar o que você preencheu?");
    expect(folha()).not.toBeNull();
  });

  it("'Continuar preenchendo' mantém a folha e o que estava marcado", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis", folha()));
    await fecharPeloX();
    await clicar(botao("Continuar preenchendo", aviso()));

    expect(onAbertoMudou).not.toHaveBeenCalled();
    expect(aviso()).toBeNull();
    // A quantidade marcada continua lá: o passo 1 ainda deixa avançar.
    await clicar(botao("Continuar", folha()));
    expect(
      folha()?.querySelector('[data-testid="passo-motivo"]'),
    ).not.toBeNull();
  });

  it("'Descartar' fecha de verdade", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis", folha()));
    await fecharPeloX();
    await clicar(botao("Descartar", aviso()));

    expect(onAbertoMudou).toHaveBeenCalledTimes(1);
    expect(onAbertoMudou).toHaveBeenCalledWith(false);
  });

  it("Esc com algo preenchido também pergunta", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis", folha()));
    await apertarEsc();

    expect(onAbertoMudou).not.toHaveBeenCalled();
    expect(aviso()?.textContent).toContain("Descartar o que você preencheu?");
  });

  it("motivo escolhido e foto anexada pedem confirmação", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis", folha()));
    await clicar(botao("Continuar", folha()));
    await clicar(radio("defeito"));
    await escolherFoto();
    await fecharPeloX();

    expect(onAbertoMudou).not.toHaveBeenCalled();
    expect(aviso()?.textContent).toContain("fotos");
  });

  it("pedido enviado (protocolo na tela): fecha direto, nada a perder", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis", folha()));
    await clicar(botao("Continuar", folha()));
    await clicar(radio("tamanho_pequeno"));
    await clicar(botao("Continuar", folha()));
    await clicar(radio("reembolso"));
    await clicar(radio("envio_proprio"));
    await clicar(botao("Continuar", folha()));
    await clicar(botao("Confirmar devolução", folha()));
    expect(
      document.querySelector('[data-testid="devolucao-sucesso"]'),
    ).not.toBeNull();

    await fecharPeloX();

    expect(onAbertoMudou).toHaveBeenCalledWith(false);
    expect(aviso()).toBeNull();
  });
});
