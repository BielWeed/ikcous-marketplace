// @vitest-environment jsdom
//
// Apertar F5, recarregar a página ou fechar a aba com a folha de devolução/troca
// preenchida (motivo, descrição, fotos) apagava tudo SEM aviso: só o fechar pela
// folha (X, Esc, Voltar) perguntava. Agora, ENQUANTO houver rascunho, o
// navegador mostra o aviso "sair desta página?" (`beforeunload` cancelado). Sem
// nada preenchido, depois de descartar, de fechar, de desmontar ou de o pedido
// ter sido aceito, o ouvinte não existe e a saída é livre.
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

// O jsdom não decodifica imagem: a conferência "a foto abre?" é dublada aqui.
vi.mock("@/lib/imagem-abre", () => ({ imagemAbre: async () => true }));

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

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  solicitar.mockReset();
  enviarFoto.mockReset();
  descartarFotos.mockReset();
  descartarFotos.mockResolvedValue(undefined);
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

async function clicar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    el?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    el?.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

const radio = (valor: string) =>
  folha()?.querySelector<HTMLInputElement>(
    `input[type="radio"][value="${valor}"]`,
  );

async function ateARevisao(motivo: string, resolucao: string, metodo: string) {
  await clicar(botao("Aumentar Tênis", folha()));
  await clicar(botao("Continuar", folha()));
  await clicar(radio(motivo));
  await clicar(botao("Continuar", folha()));
  await clicar(radio(resolucao));
  await clicar(radio(metodo));
  await clicar(botao("Continuar", folha()));
}

// O que o navegador faz ao recarregar/fechar a aba: o aviso só aparece se
// alguém cancelou o evento.
function recarregarAAba(): boolean {
  const evento = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(evento);
  return evento.defaultPrevented;
}

describe("SolicitarDevolucaoSheet — recarregar a página avisa enquanto há rascunho", () => {
  it("nada preenchido: recarregar não pede confirmação", async () => {
    await montar();

    expect(recarregarAAba()).toBe(false);
  });

  it("item marcado e motivo escolhido: recarregar pede confirmação", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis", folha()));
    await clicar(botao("Continuar", folha()));
    await clicar(radio("tamanho_pequeno"));

    expect(recarregarAAba()).toBe(true);
  });

  it("depois de 'Descartar' a folha fecha e recarregar não pede mais confirmação", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis", folha()));
    expect(recarregarAAba()).toBe(true);

    await clicar(botao("Fechar", folha()));
    await clicar(botao("Descartar", aviso()));

    expect(folha()).toBeNull();
    expect(recarregarAAba()).toBe(false);
  });

  it("desmontar a folha com rascunho solta o ouvinte", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis", folha()));
    expect(recarregarAAba()).toBe(true);

    await act(async () => raiz.unmount());

    expect(recarregarAAba()).toBe(false);
    // O afterEach desmonta de novo: uma raiz nova mantém a limpeza simétrica.
    raiz = createRoot(hospedeiro);
  });

  it("pedido enviando: recarregar ainda pede confirmação (está em voo)", async () => {
    solicitar.mockReturnValue(new Promise(() => {}));
    await montar();
    await ateARevisao("tamanho_pequeno", "reembolso", "envio_proprio");
    await clicar(botao("Confirmar devolução", folha()));
    expect(solicitar).toHaveBeenCalledTimes(1);

    expect(recarregarAAba()).toBe(true);
  });

  it("pedido aceito (protocolo na tela): nada a perder, recarregar não pede confirmação", async () => {
    await montar();
    await ateARevisao("tamanho_pequeno", "reembolso", "envio_proprio");
    await clicar(botao("Confirmar devolução", folha()));
    expect(
      document.querySelector('[data-testid="devolucao-sucesso"]'),
    ).not.toBeNull();

    expect(recarregarAAba()).toBe(false);
  });
});
