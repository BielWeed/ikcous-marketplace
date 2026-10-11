// @vitest-environment jsdom
//
// A foto que o cliente enviou e NÃO usou não pode ficar no bucket privado
// `devolucoes` para sempre (pendência da passagem de 26/09, §6). A folha de
// pedido de devolução (SolicitarDevolucaoSheet) sobe as fotos antes de chamar a
// RPC; daqui saem os casos em que elas viram lixo — foto tirada da lista depois
// de enviada, folha fechada sem concluir — e os dois em que NÃO se pode apagar:
// solicitação aceita (a foto é da devolução) e folha fechada com o envio em
// andamento (a RPC pode estar gravando justamente esses caminhos).
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
    texto_politica: null,
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
  onAbertoMudou.mockReset();
  enviarFoto.mockResolvedValue({ ok: true, valor: "u-1/o-1/abc.jpg" });
  descartarFotos.mockResolvedValue(undefined);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  // Quem desmonta dentro do teste já o fez; aqui só o que sobrou.
  try {
    act(() => raiz.unmount());
  } catch {
    // já desmontada
  }
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
        descartarFotos={descartarFotos}
      />,
    );
  });
}

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
}

/** Do passo 1 até o botão "Confirmar devolução", com UMA foto escolhida. */
async function ateARevisaoComFoto() {
  await montar();
  await clicar(botao("Aumentar Tênis"));
  await clicar(botao("Continuar"));
  await clicar(radio("avariado_no_transporte"));
  await escolherFoto();
  await clicar(botao("Continuar"));
  await clicar(radio("reembolso"));
  await clicar(radio("envio_proprio"));
  await clicar(botao("Continuar"));
}

describe("SolicitarDevolucaoSheet — foto enviada e não usada é apagada", () => {
  it("recusa do servidor e a folha fecha: a foto que subiu é apagada", async () => {
    solicitar.mockResolvedValue({
      ok: false,
      erro: "Já existe uma devolução em andamento para este pedido.",
    });
    await ateARevisaoComFoto();
    await clicar(botao("Confirmar devolução"));

    expect(enviarFoto).toHaveBeenCalledTimes(1);
    expect(solicitar).toHaveBeenCalledTimes(1);
    // Ainda aberta: nada some enquanto o cliente pode tentar de novo.
    expect(descartarFotos).not.toHaveBeenCalled();

    act(() => raiz.unmount());
    expect(descartarFotos).toHaveBeenCalledTimes(1);
    expect(descartarFotos).toHaveBeenCalledWith(["u-1/o-1/abc.jpg"]);
  });

  it("solicitação aceita: a foto é da devolução e NUNCA é apagada ao fechar", async () => {
    solicitar.mockResolvedValue({
      ok: true,
      valor: {
        id: "d-1",
        protocolo: "DV260926-ABCDE",
        tipo: "vicio",
        status: "solicitada",
      },
    });
    await ateARevisaoComFoto();
    await clicar(botao("Confirmar devolução"));
    expect(
      document.querySelector('[data-testid="devolucao-sucesso"]'),
    ).not.toBeNull();

    act(() => raiz.unmount());
    expect(descartarFotos).not.toHaveBeenCalled();
  });

  it("fechar com o envio EM ANDAMENTO não apaga na hora: a RPC pode estar gravando esses caminhos", async () => {
    let concluir: (v: unknown) => void = () => {};
    solicitar.mockReturnValue(
      new Promise((resolve) => {
        concluir = resolve;
      }),
    );
    await ateARevisaoComFoto();
    await clicar(botao("Confirmar devolução"));
    expect(solicitar).toHaveBeenCalledTimes(1);

    act(() => raiz.unmount());
    expect(descartarFotos).not.toHaveBeenCalled();
    await act(async () => {
      concluir({
        ok: true,
        valor: {
          id: "d-1",
          protocolo: "DV1",
          tipo: "vicio",
          status: "solicitada",
        },
      });
    });
    // Aceita depois de fechada: as fotos são da devolução.
    expect(descartarFotos).not.toHaveBeenCalled();
  });

  it("fechou durante o envio e a RPC RECUSA depois: a foto que subiu é apagada ao fim do envio", async () => {
    let concluir: (v: unknown) => void = () => {};
    solicitar.mockReturnValue(
      new Promise((resolve) => {
        concluir = resolve;
      }),
    );
    await ateARevisaoComFoto();
    await clicar(botao("Confirmar devolução"));

    act(() => raiz.unmount());
    expect(descartarFotos).not.toHaveBeenCalled();
    await act(async () => {
      concluir({ ok: false, erro: "Já existe uma devolução em andamento." });
    });
    expect(descartarFotos).toHaveBeenCalledTimes(1);
    expect(descartarFotos).toHaveBeenCalledWith(["u-1/o-1/abc.jpg"]);
  });

  it("recusa com a folha ainda ABERTA não apaga: o cliente pode tentar de novo com as mesmas fotos", async () => {
    solicitar.mockResolvedValue({ ok: false, erro: "Tente de novo." });
    await ateARevisaoComFoto();
    await clicar(botao("Confirmar devolução"));
    expect(descartarFotos).not.toHaveBeenCalled();
  });

  it("tirar da lista uma foto que JÁ subiu apaga só essa foto do bucket", async () => {
    solicitar.mockResolvedValue({
      ok: false,
      erro: "Já existe uma devolução em andamento para este pedido.",
    });
    await ateARevisaoComFoto();
    await clicar(botao("Confirmar devolução"));
    expect(descartarFotos).not.toHaveBeenCalled();

    // Volta ao passo das fotos e remove a que já tinha subido.
    await clicar(botao("Voltar"));
    await clicar(botao("Voltar"));
    await clicar(botao("Remover foto"));
    expect(descartarFotos).toHaveBeenCalledTimes(1);
    expect(descartarFotos).toHaveBeenCalledWith(["u-1/o-1/abc.jpg"]);

    // Já não há foto na lista: fechar não apaga de novo.
    act(() => raiz.unmount());
    expect(descartarFotos).toHaveBeenCalledTimes(1);
  });

  it("tirar da lista uma foto que ainda NÃO subiu não chama o bucket", async () => {
    await montar();
    await clicar(botao("Aumentar Tênis"));
    await clicar(botao("Continuar"));
    await clicar(radio("avariado_no_transporte"));
    await escolherFoto();
    await clicar(botao("Remover foto"));

    expect(enviarFoto).not.toHaveBeenCalled();
    expect(descartarFotos).not.toHaveBeenCalled();
    act(() => raiz.unmount());
    expect(descartarFotos).not.toHaveBeenCalled();
  });

  it("sem foto nenhuma, fechar a folha não chama o bucket", async () => {
    await montar();
    act(() => raiz.unmount());
    expect(descartarFotos).not.toHaveBeenCalled();
  });
});
