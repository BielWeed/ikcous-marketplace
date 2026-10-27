// @vitest-environment jsdom
//
// VOLTAR DO CELULAR COM A FOLHA DE DEVOLUÇÃO ABERTA. O defeito: no Android, com
// a folha "Devolver ou trocar" aberta e itens, motivo, texto ou fotos já
// preenchidos, o Voltar tirava a cliente da tela do pedido e o rascunho se
// perdia. Agora o Voltar faz o MESMO que o botão de fechar: sem rascunho fecha
// só a folha; com rascunho pergunta "Descartar o que você preencheu?" (a folha
// e o preenchido ficam). A tela de baixo não sai de cena e nenhuma entrada de
// histórico sobra.
//
// Histórico REAL do jsdom e um "App" simulado que só navega quando a tela do
// histórico muda (o "já estamos no mesmo destino" do `syncWithUrl`).
// Molde: devolucao-fechar-a-folha-nao-perde-o-preenchido.test.tsx.
import { act, useState } from "react";
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
const descartarFotos = vi.fn();
const onAbertoMudou = vi.fn();

function esperar(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
let navegacoesDoApp: string[];
const ouvintes: Array<(e: PopStateEvent) => void> = [];

const telaDoHistorico = () =>
  `${globalThis.history.state?.view}|${globalThis.location.pathname}`;

beforeEach(() => {
  solicitar.mockReset();
  enviarFoto.mockReset();
  descartarFotos.mockReset();
  descartarFotos.mockResolvedValue(undefined);
  onAbertoMudou.mockReset();
  globalThis.history.replaceState({ view: "orders" }, "", "/orders");
  globalThis.history.pushState(
    { view: "order-details", id: "p-1" },
    "",
    "/order-details?id=p-1",
  );
  navegacoesDoApp = [];
  let telaMostrada = telaDoHistorico();
  const ouvinte = () => {
    const alvo = telaDoHistorico();
    if (alvo === telaMostrada) return;
    telaMostrada = alvo;
    navegacoesDoApp.push(alvo);
  };
  ouvintes.push(ouvinte);
  globalThis.addEventListener("popstate", ouvinte);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  for (const o of ouvintes.splice(0)) {
    globalThis.removeEventListener("popstate", o);
  }
});

// Dono do `aberto`, como a tela do pedido: fechar de verdade desmonta a folha.
async function montar() {
  const { SolicitarDevolucaoSheet } = await import(
    "@/components/devolucao/SolicitarDevolucaoSheet"
  );
  function Dono() {
    const [aberto, setAberto] = useState(true);
    return (
      <SolicitarDevolucaoSheet
        aberto={aberto}
        onAbertoMudou={(valor) => {
          onAbertoMudou(valor);
          setAberto(valor);
        }}
        elegibilidade={ELEGIBILIDADE}
        userId="u-1"
        enderecoDaLoja="Rua A, 10"
        horarioDaLoja="Seg a Sex, 9h às 18h"
        solicitar={solicitar}
        enviarFoto={enviarFoto}
        descartarFotos={descartarFotos}
      />
    );
  }
  await act(async () => {
    raiz.render(<Dono />);
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

// Toque de verdade (o guardião do sheet.tsx olha pointerdown/pointerup).
async function clicar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    el?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    el?.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  // Dá tempo ao `history.back()` que o fechamento pede e ao retorno engolido.
  await act(async () => {
    await esperar(120);
  });
}

/** Aperta o Voltar do aparelho: histórico real do jsdom. */
async function apertarVoltar() {
  await act(async () => {
    globalThis.history.back();
    await esperar(60);
  });
  await act(async () => {
    await esperar(120);
  });
}

const MARCA = { folhaDePolitica: true };
const TELA = { view: "order-details", id: "p-1" };

describe("SolicitarDevolucaoSheet — o Voltar do celular fecha só a folha", () => {
  it("abrir a folha empurra UMA entrada com o mesmo endereço do pedido", async () => {
    const antes = globalThis.history.length;
    await montar();
    expect(globalThis.history.length).toBe(antes + 1);
    expect(globalThis.location.pathname + globalThis.location.search).toBe(
      "/order-details?id=p-1",
    );
    expect(globalThis.history.state).toMatchObject({ ...TELA, ...MARCA });
  });

  it("nada preenchido: o Voltar fecha a folha, a tela fica e não sobra entrada", async () => {
    await montar();
    await apertarVoltar();

    expect(onAbertoMudou).toHaveBeenCalledWith(false);
    expect(folha()).toBeNull();
    expect(aviso()).toBeNull();
    expect(navegacoesDoApp).toEqual([]);
    expect(globalThis.history.state).toEqual(TELA);
    // O Voltar seguinte já é do roteador.
    await apertarVoltar();
    expect(navegacoesDoApp).toEqual(["orders|/orders"]);
  });

  it("com rascunho: o Voltar PERGUNTA e a folha, com o preenchido, continua", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis", folha()));
    await apertarVoltar();

    expect(onAbertoMudou).not.toHaveBeenCalled();
    expect(aviso()?.textContent).toContain("Descartar o que você preencheu?");
    expect(folha()).not.toBeNull();
    expect(navegacoesDoApp).toEqual([]);
    // A entrada que o Voltar consumiu foi empurrada de novo.
    expect(globalThis.history.state).toMatchObject(MARCA);
  });

  it("com a pergunta na tela, outro Voltar é 'Continuar preenchendo'", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis", folha()));
    await apertarVoltar();
    await apertarVoltar();

    expect(aviso()).toBeNull();
    expect(folha()).not.toBeNull();
    expect(onAbertoMudou).not.toHaveBeenCalled();
    expect(navegacoesDoApp).toEqual([]);
    expect(globalThis.history.state).toMatchObject(MARCA);
  });

  it("'Descartar' depois do Voltar fecha a folha sem deixar entrada sobrando", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis", folha()));
    await apertarVoltar();
    await clicar(botao("Descartar", aviso()));

    expect(onAbertoMudou).toHaveBeenCalledWith(false);
    expect(folha()).toBeNull();
    expect(navegacoesDoApp).toEqual([]);
    expect(globalThis.history.state).toEqual(TELA);
    await apertarVoltar();
    expect(navegacoesDoApp).toEqual(["orders|/orders"]);
  });

  it("fechar pelo X consome a entrada: a tela não recua", async () => {
    await montar();
    await clicar(botao("Fechar", folha()));

    expect(onAbertoMudou).toHaveBeenCalledWith(false);
    expect(folha()).toBeNull();
    expect(navegacoesDoApp).toEqual([]);
    expect(globalThis.history.state).toEqual(TELA);
  });
});
