// @vitest-environment jsdom
//
// Folha de pedido de devolução/troca do CLIENTE (SolicitarDevolucaoSheet):
// quatro passos — itens, motivo (+ fotos), resolução e forma de devolver,
// revisão com a nota legal — e o protocolo na hora (Decreto 7.962/2013).
// Prova o caminho feliz com o PAYLOAD exato da RPC, a validação de cada
// passo (inclusive a foto obrigatória para problema no produto) e que a
// recusa do servidor aparece como veio.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DadosDaSolicitacao } from "@/hooks/useDevolucaoCliente";
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

async function montar(elegibilidade = ELEGIBILIDADE) {
  const { SolicitarDevolucaoSheet } = await import(
    "@/components/devolucao/SolicitarDevolucaoSheet"
  );
  await act(async () => {
    raiz.render(
      <SolicitarDevolucaoSheet
        aberto
        onAbertoMudou={onAbertoMudou}
        elegibilidade={elegibilidade}
        userId="u-1"
        enderecoDaLoja="Rua A, 10"
        horarioDaLoja="Seg a Sex, 9h às 18h"
        solicitar={solicitar}
        enviarFoto={enviarFoto}
      />,
    );
  });
}

// A folha é portalada no body: busca no DOCUMENTO.
const folha = () =>
  document.querySelector<HTMLElement>('[data-testid="folha-devolucao"]');

function botao(texto: string): HTMLButtonElement | undefined {
  return Array.from(folha()?.querySelectorAll("button") ?? []).find(
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

const radio = (valor: string) =>
  folha()?.querySelector<HTMLInputElement>(
    `input[type="radio"][value="${valor}"]`,
  );

const alerta = () =>
  folha()?.querySelector('[role="alert"]')?.textContent ?? "";

async function escolherFoto(nome = "foto.jpg") {
  const entrada = folha()?.querySelector<HTMLInputElement>(
    '[data-testid="entrada-fotos-devolucao"]',
  );
  expect(entrada).toBeTruthy();
  const arquivo = new File(["x"], nome, { type: "image/jpeg" });
  Object.defineProperty(entrada, "files", {
    configurable: true,
    value: [arquivo],
  });
  await act(async () => {
    entrada?.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return arquivo;
}

describe("SolicitarDevolucaoSheet — pedido de devolução do cliente", () => {
  it("caminho feliz: item, motivo, resolução e método viram o payload da RPC e o protocolo aparece", async () => {
    await montar();
    expect(folha()?.textContent).toContain("O que vai voltar?");
    // Prazos da elegibilidade à vista no primeiro passo.
    expect(folha()?.textContent).toContain("até 01/10/2026");
    expect(folha()?.textContent).toContain("até 23/12/2026");

    // Passo 1 sem item: não avança, e diz por quê.
    await clicar(botao("Continuar"));
    expect(alerta()).toContain("Escolha ao menos um item para devolver.");

    await clicar(botao("Aumentar Tênis"));
    await clicar(botao("Continuar"));

    // Passo 2
    expect(
      folha()?.querySelector('[data-testid="passo-motivo"]'),
    ).not.toBeNull();
    await clicar(radio("tamanho_pequeno"));
    await clicar(botao("Continuar"));

    // Passo 3: reembolso existe (arrependimento aberto); método nacional.
    expect(radio("reembolso")).toBeTruthy();
    await clicar(radio("reembolso"));
    await clicar(radio("envio_proprio"));
    await clicar(botao("Continuar"));

    // Passo 4: revisão + nota legal (art. 49) + frete só com pedido inteiro.
    const revisao = folha()?.querySelector('[data-testid="passo-revisao"]');
    expect(revisao?.textContent).toContain("1× Tênis");
    expect(revisao?.textContent).toContain("art. 49");
    expect(revisao?.textContent).toContain(
      "O frete de ida só é devolvido quando o pedido volta inteiro.",
    );

    await clicar(botao("Confirmar devolução"));

    expect(enviarFoto).not.toHaveBeenCalled();
    expect(solicitar).toHaveBeenCalledTimes(1);
    const dados = solicitar.mock.calls[0][0] as DadosDaSolicitacao;
    expect(dados).toEqual({
      itens: [{ order_item_id: "oi-1", quantidade: 1 }],
      motivo: "tamanho_pequeno",
      detalhe: "",
      resolucao: "reembolso",
      metodo: "envio_proprio",
      fotos: [],
    });

    const sucesso = document.querySelector('[data-testid="devolucao-sucesso"]');
    expect(sucesso?.textContent).toContain("DV260926-ABCDE");
    expect(sucesso?.textContent).toContain("Pedido de devolução enviado");
  });

  it("problema no produto exige foto: sem ela o passo 2 não avança; com ela, a foto sobe antes da RPC", async () => {
    enviarFoto.mockResolvedValue({ ok: true, valor: "u-1/oi/abc.jpg" });
    solicitar.mockResolvedValue({
      ok: true,
      valor: {
        id: "d-2",
        protocolo: "DV2",
        tipo: "vicio",
        status: "solicitada",
      },
    });
    await montar();

    await clicar(botao("Aumentar Tênis"));
    await clicar(botao("Aumentar Tênis"));
    await clicar(botao("Continuar"));

    await clicar(radio("defeito"));
    expect(folha()?.textContent).toContain(
      "obrigatório para problema no produto",
    );
    await clicar(botao("Continuar"));
    expect(alerta()).toBe("Envie ao menos uma foto do problema no produto.");
    expect(
      folha()?.querySelector('[data-testid="passo-motivo"]'),
    ).not.toBeNull();

    const arquivo = await escolherFoto();
    await clicar(botao("Continuar"));
    expect(
      folha()?.querySelector('[data-testid="passo-resolucao"]'),
    ).not.toBeNull();

    await clicar(radio("troca"));
    await clicar(radio("etiqueta_reversa"));
    await clicar(botao("Continuar"));

    const revisao = folha()?.querySelector('[data-testid="passo-revisao"]');
    expect(revisao?.textContent).toContain("arts. 18 e 26");
    // As 2 unidades = pedido inteiro: o frete de ida volta junto.
    expect(revisao?.textContent).toContain(
      "o frete que você pagou também é devolvido",
    );

    await clicar(botao("Confirmar devolução"));

    expect(enviarFoto).toHaveBeenCalledWith(arquivo, "u-1");
    expect(solicitar).toHaveBeenCalledWith(
      expect.objectContaining({
        itens: [{ order_item_id: "oi-1", quantidade: 2 }],
        motivo: "defeito",
        resolucao: "troca",
        metodo: "etiqueta_reversa",
        fotos: ["u-1/oi/abc.jpg"],
      }),
    );
    expect(enviarFoto.mock.invocationCallOrder[0]).toBeLessThan(
      solicitar.mock.invocationCallOrder[0],
    );
  });

  it("fora do arrependimento, 'mudei de ideia' só oferece troca ou vale", async () => {
    await montar({
      ...ELEGIBILIDADE,
      janelas: { arrependimento: false, troca: true, vicio: true },
    });
    await clicar(botao("Aumentar Tênis"));
    await clicar(botao("Continuar"));
    await clicar(radio("nao_gostei"));
    await clicar(botao("Continuar"));

    expect(radio("reembolso")).toBeFalsy();
    expect(radio("troca")).toBeTruthy();
    expect(radio("vale")).toBeTruthy();
    expect(folha()?.textContent).toContain(
      "O prazo de arrependimento terminou",
    );
  });

  it("falha no envio da foto para tudo antes da RPC e mostra o motivo", async () => {
    enviarFoto.mockResolvedValue({
      ok: false,
      erro: "A foto passa de 5 MB. Escolha uma menor.",
    });
    await montar();
    await clicar(botao("Aumentar Tênis"));
    await clicar(botao("Continuar"));
    await clicar(radio("avariado_no_transporte"));
    await escolherFoto();
    await clicar(botao("Continuar"));
    await clicar(radio("reembolso"));
    await clicar(radio("envio_proprio"));
    await clicar(botao("Continuar"));
    await clicar(botao("Confirmar devolução"));

    expect(solicitar).not.toHaveBeenCalled();
    expect(alerta()).toBe("A foto passa de 5 MB. Escolha uma menor.");
  });

  it("recusa do servidor aparece como veio, sem tela de sucesso", async () => {
    solicitar.mockResolvedValue({
      ok: false,
      erro: "Já existe uma devolução em andamento para este pedido.",
    });
    await montar();
    await clicar(botao("Aumentar Tênis"));
    await clicar(botao("Continuar"));
    await clicar(radio("desisti"));
    await clicar(botao("Continuar"));
    await clicar(radio("vale"));
    await clicar(radio("envio_proprio"));
    await clicar(botao("Continuar"));
    await clicar(botao("Confirmar devolução"));

    expect(alerta()).toBe(
      "Já existe uma devolução em andamento para este pedido.",
    );
    expect(
      document.querySelector('[data-testid="devolucao-sucesso"]'),
    ).toBeNull();
  });
});
