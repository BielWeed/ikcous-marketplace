// @vitest-environment jsdom
//
// Folha de pedido de devolução (SolicitarDevolucaoSheet) — bordas sem guarda:
//  1. Foto com EXATAMENTE o tamanho máximo entra sem ser reduzida; a foto maior
//     que o máximo é reduzida, e se a reduzida ficar EXATAMENTE no máximo, entra.
//  2. Só o caso "um item, uma unidade" já vem marcado. Dois itens de uma unidade
//     cada NÃO vêm marcados (a cliente tem de escolher o que devolve).
//  3. Depois de escolher fotos, o campo de arquivo é esvaziado: escolher a MESMA
//     foto de novo (depois de tirá-la) dispara a escolha outra vez.
//  4. Tirar da lista uma foto que já subiu a apaga do bucket UMA vez só, mesmo
//     com dois toques seguidos no "Remover foto".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TAMANHO_MAXIMO_DA_FOTO } from "@/lib/devolucao";
import type { ElegibilidadeDevolucao } from "@/types/devolucao";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

const redimensionarImagem = vi.fn(async (arquivo: File) => arquivo);
vi.mock("@/lib/redimensiona-imagem", () => ({
  redimensionarImagem: (arquivo: File) => redimensionarImagem(arquivo),
}));

vi.mock("@/lib/imagem-abre", () => ({ imagemAbre: async () => true }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const item = (id: string, nome: string, disponivel: number) => ({
  order_item_id: id,
  product_id: `p-${id}`,
  product_name: nome,
  image_url: null,
  quantidade: disponivel,
  ja_devolvida: 0,
  disponivel,
  valor_unitario: 100,
});

const elegibilidade = (
  itens: ElegibilidadeDevolucao["itens"],
): ElegibilidadeDevolucao => ({
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
  itens,
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
});

const solicitar = vi.fn();
const enviarFoto = vi.fn();
const descartarFotos = vi.fn();
let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  solicitar.mockReset();
  enviarFoto
    .mockReset()
    .mockResolvedValue({ ok: true, valor: "u-1/o-1/a.jpg" });
  descartarFotos.mockReset().mockResolvedValue(undefined);
  redimensionarImagem.mockReset().mockImplementation(async (a) => a);
  vi.mocked(toast.error).mockClear();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  try {
    act(() => raiz.unmount());
  } catch {
    // já desmontada
  }
  hospedeiro.remove();
  document.body.innerHTML = "";
});

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

async function montar(itens: ElegibilidadeDevolucao["itens"]) {
  const { SolicitarDevolucaoSheet } = await import(
    "@/components/devolucao/SolicitarDevolucaoSheet"
  );
  await act(async () => {
    raiz.render(
      <SolicitarDevolucaoSheet
        aberto
        onAbertoMudou={vi.fn()}
        elegibilidade={elegibilidade(itens)}
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

const entrada = () =>
  folha()?.querySelector<HTMLInputElement>(
    '[data-testid="entrada-fotos-devolucao"]',
  ) as HTMLInputElement;

async function escolher(arquivos: File[]) {
  Object.defineProperty(entrada(), "files", {
    configurable: true,
    value: arquivos,
  });
  await act(async () => {
    entrada().dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

const fotosNaLista = () =>
  Array.from(folha()?.querySelectorAll("button") ?? []).filter(
    (b) => b.getAttribute("aria-label") === "Remover foto",
  ).length;

async function ateOPassoDasFotos() {
  await montar([item("oi-1", "Tênis", 2)]);
  await clicar(botao("Aumentar Tênis"));
  await clicar(botao("Continuar"));
}

const png = (nome: string, bytes: number) =>
  new File([new Uint8Array(bytes)], nome, { type: "image/png" });

describe("SolicitarDevolucaoSheet — tamanho máximo da foto, nos limites", () => {
  it("foto com EXATAMENTE o máximo entra sem ser reduzida", async () => {
    await ateOPassoDasFotos();
    await escolher([png("no-teto.png", TAMANHO_MAXIMO_DA_FOTO)]);

    expect(fotosNaLista()).toBe(1);
    expect(redimensionarImagem).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("foto maior que o máximo é reduzida; reduzida EXATAMENTE no máximo entra", async () => {
    redimensionarImagem.mockImplementation(async () =>
      png("reduzida.png", TAMANHO_MAXIMO_DA_FOTO),
    );
    await ateOPassoDasFotos();
    await escolher([png("grande.png", TAMANHO_MAXIMO_DA_FOTO + 1)]);

    expect(redimensionarImagem).toHaveBeenCalledTimes(1);
    expect(fotosNaLista()).toBe(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("reduzida UM byte acima do máximo é recusada com o nome da foto", async () => {
    redimensionarImagem.mockImplementation(async () =>
      png("reduzida.png", TAMANHO_MAXIMO_DA_FOTO + 1),
    );
    await ateOPassoDasFotos();
    await escolher([png("enorme.png", TAMANHO_MAXIMO_DA_FOTO + 5)]);

    expect(fotosNaLista()).toBe(0);
    expect(String(vi.mocked(toast.error).mock.calls[0]?.[0])).toContain(
      "enorme.png",
    );
  });
});

describe("SolicitarDevolucaoSheet — o que já vem marcado", () => {
  it("um item de uma unidade já vem marcado: Continuar avança", async () => {
    await montar([item("oi-1", "Tênis", 1)]);
    await clicar(botao("Continuar"));
    expect(
      document.querySelector('[data-testid="passo-motivo"]'),
    ).not.toBeNull();
  });

  it("dois itens de uma unidade cada NÃO vêm marcados: Continuar fica no passo 1", async () => {
    await montar([item("oi-1", "Tênis", 1), item("oi-2", "Meia", 1)]);
    await clicar(botao("Continuar"));
    expect(
      document.querySelector('[data-testid="passo-itens"]'),
    ).not.toBeNull();
    expect(document.querySelector('[data-testid="passo-motivo"]')).toBeNull();
  });
});

describe("SolicitarDevolucaoSheet — campo de arquivo das fotos", () => {
  it("depois de escolher, o campo é esvaziado (a mesma foto pode ser escolhida de novo)", async () => {
    await ateOPassoDasFotos();
    let valor = "C:\\fakepath\\boa.jpg";
    Object.defineProperty(entrada(), "value", {
      configurable: true,
      get: () => valor,
      set: (novo: string) => {
        valor = novo;
      },
    });

    await escolher([new File(["x"], "boa.jpg", { type: "image/jpeg" })]);

    expect(fotosNaLista()).toBe(1);
    expect(valor).toBe("");
  });
});

describe("SolicitarDevolucaoSheet — tirar da lista uma foto que já subiu", () => {
  it("dois toques seguidos no 'Remover foto' apagam do bucket uma vez só", async () => {
    solicitar.mockResolvedValue({ ok: false, erro: "Pedido recusado." });
    await ateOPassoDasFotos();
    await clicar(radio("avariado_no_transporte"));
    await escolher([new File(["x"], "foto.jpg", { type: "image/jpeg" })]);
    await clicar(botao("Continuar"));
    await clicar(radio("reembolso"));
    await clicar(radio("envio_proprio"));
    await clicar(botao("Continuar"));
    await clicar(botao("Confirmar devolução"));
    // A foto subiu (tem caminho) e o pedido foi recusado: volta ao passo das fotos.
    expect(enviarFoto).toHaveBeenCalledTimes(1);
    await clicar(botao("Voltar"));
    await clicar(botao("Voltar"));
    expect(fotosNaLista()).toBe(1);

    const remover = botao("Remover foto");
    await act(async () => {
      remover?.click();
      remover?.click();
    });

    expect(fotosNaLista()).toBe(0);
    expect(descartarFotos).toHaveBeenCalledTimes(1);
    expect(descartarFotos).toHaveBeenCalledWith(["u-1/o-1/a.jpg"]);
  });
});
