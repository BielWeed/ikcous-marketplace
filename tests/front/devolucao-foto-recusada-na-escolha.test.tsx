// @vitest-environment jsdom
//
// Foto de devolução recusada NA ESCOLHA, com o nome do arquivo (SolicitarDevolucaoSheet).
// Antes, a folha aceitava qualquer arquivo e a recusa (tipo fora de JPG/PNG/WEBP,
// mais de 5 MB) só vinha no "Confirmar", no último passo, sem dizer qual foto era
// a ruim. Agora a foto ruim é barrada ao escolher; as boas da mesma escolha entram.
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

// O navegador de verdade reduz JPEG/PNG grande; aqui o teste decide o resultado.
const redimensionarImagem = vi.fn(async (arquivo: File) => arquivo);
vi.mock("@/lib/redimensiona-imagem", () => ({
  redimensionarImagem: (arquivo: File) => redimensionarImagem(arquivo),
}));

// O jsdom não decodifica imagem: o teste decide quais fotos "abrem" no aparelho.
const imagemAbre = vi.fn(async (_arquivo: File) => true);
vi.mock("@/lib/imagem-abre", () => ({
  imagemAbre: (arquivo: File) => imagemAbre(arquivo),
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

const enviarFoto = vi.fn();
let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  enviarFoto.mockReset();
  redimensionarImagem.mockClear();
  imagemAbre.mockReset().mockResolvedValue(true);
  vi.mocked(toast.error).mockClear();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
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

const fotosNaLista = () =>
  Array.from(folha()?.querySelectorAll("button") ?? []).filter(
    (b) => b.getAttribute("aria-label") === "Remover foto",
  ).length;

/** Abre a folha e vai ao passo do motivo, onde as fotos são escolhidas. */
async function ateOPassoDasFotos() {
  const { SolicitarDevolucaoSheet } = await import(
    "@/components/devolucao/SolicitarDevolucaoSheet"
  );
  await act(async () => {
    raiz.render(
      <SolicitarDevolucaoSheet
        aberto
        onAbertoMudou={vi.fn()}
        elegibilidade={ELEGIBILIDADE}
        userId="u-1"
        enderecoDaLoja="Rua A, 10"
        horarioDaLoja="Seg a Sex, 9h às 18h"
        solicitar={vi.fn()}
        enviarFoto={enviarFoto}
        descartarFotos={vi.fn()}
      />,
    );
  });
  await clicar(botao("Aumentar Tênis"));
  await clicar(botao("Continuar"));
}

async function escolher(arquivos: File[]) {
  const entrada = folha()?.querySelector<HTMLInputElement>(
    '[data-testid="entrada-fotos-devolucao"]',
  );
  expect(entrada).toBeTruthy();
  Object.defineProperty(entrada, "files", {
    configurable: true,
    value: arquivos,
  });
  await act(async () => {
    entrada?.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

const boa = () => new File(["x"], "boa.jpg", { type: "image/jpeg" });
const grande = (nome: string) =>
  new File([new Uint8Array(TAMANHO_MAXIMO_DA_FOTO + 1)], nome, {
    type: "image/png",
  });

describe("SolicitarDevolucaoSheet — foto ruim é barrada ao escolher", () => {
  it("tipo fora de JPG/PNG/WEBP: avisa com o NOME do arquivo e as outras fotos entram", async () => {
    await ateOPassoDasFotos();
    await escolher([
      boa(),
      new File(["x"], "IMG_0042.heic", { type: "image/heic" }),
    ]);

    expect(fotosNaLista()).toBe(1);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toContain("IMG_0042.heic");
    // Nada foi ao servidor: o aviso veio na escolha, não no "Confirmar".
    expect(enviarFoto).not.toHaveBeenCalled();
  });

  it("foto que diz ser JPG mas o aparelho não abre: avisa com o NOME do arquivo e as outras entram", async () => {
    imagemAbre.mockImplementation(
      async (arquivo) => arquivo.name !== "estragada.jpg",
    );
    await ateOPassoDasFotos();
    await escolher([
      new File(["x"], "estragada.jpg", { type: "image/jpeg" }),
      boa(),
    ]);

    expect(fotosNaLista()).toBe(1);
    expect(toast.error).toHaveBeenCalledTimes(1);
    const aviso = String(vi.mocked(toast.error).mock.calls[0][0]);
    expect(aviso).toContain("estragada.jpg");
    expect(aviso).toContain("não abre neste aparelho");
    expect(enviarFoto).not.toHaveBeenCalled();
  });

  it("foto grande que não abre: recusada por não abrir, sem gastar a redução", async () => {
    imagemAbre.mockResolvedValue(false);
    await ateOPassoDasFotos();
    await escolher([grande("enorme.png")]);

    expect(fotosNaLista()).toBe(0);
    expect(String(vi.mocked(toast.error).mock.calls[0][0])).toContain(
      "não abre neste aparelho",
    );
    expect(redimensionarImagem).not.toHaveBeenCalled();
  });

  it("mais de 5 MB depois de reduzida: avisa com o NOME do arquivo e a boa entra", async () => {
    await ateOPassoDasFotos();
    await escolher([grande("enorme.png"), boa()]);

    expect(fotosNaLista()).toBe(1);
    expect(toast.error).toHaveBeenCalledTimes(1);
    const aviso = String(vi.mocked(toast.error).mock.calls[0][0]);
    expect(aviso).toContain("enorme.png");
    expect(aviso).toContain("5 MB");
  });

  it("foto grande que a redução traz para menos de 5 MB entra normalmente", async () => {
    redimensionarImagem.mockImplementationOnce(
      async (arquivo) =>
        new File(["pequena"], arquivo.name, { type: arquivo.type }),
    );
    await ateOPassoDasFotos();
    await escolher([grande("do-celular.png")]);

    expect(redimensionarImagem).toHaveBeenCalledTimes(1);
    expect(fotosNaLista()).toBe(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("foto boa e pequena entra sem aviso (e sem gastar a redução à toa)", async () => {
    await ateOPassoDasFotos();
    await escolher([boa()]);

    expect(fotosNaLista()).toBe(1);
    expect(toast.error).not.toHaveBeenCalled();
    expect(redimensionarImagem).not.toHaveBeenCalled();
  });
});
