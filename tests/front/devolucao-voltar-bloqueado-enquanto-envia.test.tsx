// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { ElegibilidadeDevolucao } from "@/types/devolucao";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));
// jsdom não decodifica imagens; só a conferência de abertura é dublada.
vi.mock("@/lib/imagem-abre", () => ({ imagemAbre: async () => true }));

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
let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  enviarFoto.mockResolvedValue({ ok: true, valor: "u-1/o-1/abc.jpg" });
  descartarFotos.mockResolvedValue(undefined);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
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

async function ateARevisaoComFoto() {
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
        enderecoDaLoja="Rua de Teste, 10"
        horarioDaLoja="Seg a Sex, 9h às 18h"
        solicitar={solicitar}
        enviarFoto={enviarFoto}
        descartarFotos={descartarFotos}
      />,
    );
  });
  await clicar(botao("Aumentar Tênis"));
  await clicar(botao("Continuar"));
  await clicar(radio("avariado_no_transporte"));
  const entrada = folha()?.querySelector<HTMLInputElement>(
    '[data-testid="entrada-fotos-devolucao"]',
  );
  expect(entrada).toBeTruthy();
  Object.defineProperty(entrada, "files", {
    configurable: true,
    value: [new File(["x"], "foto.jpg", { type: "image/jpeg" })],
  });
  await act(async () => {
    entrada?.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await clicar(botao("Continuar"));
  await clicar(radio("reembolso"));
  await clicar(radio("envio_proprio"));
  await clicar(botao("Continuar"));
}

it("Voltar não sai da revisão nem perde a foto enquanto envia; a recusa libera a volta", async () => {
  let recusar!: (resposta: { ok: false; erro: string }) => void;
  solicitar.mockReturnValue(
    new Promise((resolve) => {
      recusar = resolve;
    }),
  );
  await ateARevisaoComFoto();
  await clicar(botao("Confirmar devolução"));
  expect(enviarFoto).toHaveBeenCalledTimes(1);
  expect(solicitar).toHaveBeenCalledTimes(1);
  expect(solicitar).toHaveBeenCalledWith(
    expect.objectContaining({ fotos: ["u-1/o-1/abc.jpg"] }),
  );

  try {
    await clicar(botao("Voltar"));
    await clicar(botao("Voltar"));

    expect(
      folha()?.querySelector('[data-testid="passo-revisao"]'),
    ).not.toBeNull();
    expect(folha()?.textContent).toContain("Passo 4 de 4");
    expect(folha()?.textContent).toContain("1 foto");
    expect(descartarFotos).not.toHaveBeenCalled();
    expect(botao("Voltar")?.disabled).toBe(true);
  } finally {
    // Recusa de domínio (não rejeição JS): o contrato de solicitar devolve ok:false.
    await act(async () => {
      recusar({ ok: false, erro: "Tente de novo." });
    });
  }

  expect(folha()?.querySelector('[role="alert"]')?.textContent).toContain(
    "Tente de novo.",
  );
  expect(botao("Voltar")?.disabled).toBe(false);
  await clicar(botao("Voltar"));
  expect(folha()?.textContent).toContain("Passo 3 de 4");
  await clicar(botao("Voltar"));
  expect(folha()?.textContent).toContain("Passo 2 de 4");
  expect(botao("Remover foto")).toBeTruthy();
  expect(descartarFotos).not.toHaveBeenCalled();
});
