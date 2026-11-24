// @vitest-environment jsdom
//
// No celular o teclado se SOBREPÕE à página: na folha de devolução, com a
// caixa "Quer contar mais?" em foco, o botão "Continuar" do rodapé ficava
// escondido atrás dele. Agora a folha sobe acima do teclado e limita a altura
// à área visível (mesmo `useAlturaDoTeclado` da folha de resposta e da do
// Financeiro), e a caixa em foco é trazida à vista dentro do corpo que rola.
//
// A folha de devolução vira janela CENTRADA a partir de `sm:`; por isso o
// deslocamento vai por variável CSS lida só nas classes do celular, e não por
// `bottom` inline (que venceria o `sm:bottom-auto` e esticaria a janela). O
// jsdom não calcula layout: aqui se prova o contrato (variáveis + classes); a
// medida de pixels foi feita no Chromium real.
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
vi.mock("@/lib/imagem-abre", () => ({ imagemAbre: async () => true }));

let mockTeclado = 0;
let mockVisivel = 0;
vi.mock("@/hooks/useAlturaDoTeclado", () => ({
  useAlturaDoTeclado: () => ({
    altura: mockTeclado,
    alturaVisivel: mockVisivel,
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
      quantidade: 1,
      ja_devolvida: 0,
      disponivel: 1,
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

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  mockTeclado = 0;
  mockVisivel = 0;
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

async function montar() {
  const { SolicitarDevolucaoSheet } = await import(
    "@/components/devolucao/SolicitarDevolucaoSheet"
  );
  await act(async () => {
    raiz.render(
      <SolicitarDevolucaoSheet
        aberto
        onAbertoMudou={() => {}}
        elegibilidade={ELEGIBILIDADE}
        userId="u-1"
        enderecoDaLoja={null}
        horarioDaLoja={null}
        solicitar={vi.fn()}
        enviarFoto={vi.fn()}
      />,
    );
  });
}

const folha = () => {
  const el = document.querySelector<HTMLElement>(
    '[data-testid="folha-devolucao"]',
  );
  if (!el) throw new Error("folha não montou");
  return el;
};

async function clicar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    el?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    el?.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

const botao = (texto: string) =>
  Array.from(folha().querySelectorAll("button")).find(
    (b) =>
      b.textContent?.trim() === texto || b.getAttribute("aria-label") === texto,
  );

async function irAoPassoDoMotivo() {
  await clicar(botao("Aumentar Tênis"));
  await clicar(botao("Continuar"));
}

describe("SolicitarDevolucaoSheet com o teclado aberto", () => {
  it("teclado de 320px: a folha sobe 320px e cabe na área visível (480px)", async () => {
    mockTeclado = 320;
    mockVisivel = 480;
    await montar();
    expect(folha().style.getPropertyValue("--teclado-da-folha")).toBe("320px");
    expect(folha().style.getPropertyValue("--altura-da-folha")).toBe(
      "calc(480px - 1rem)",
    );
  });

  it("as classes do celular leem as variáveis e o desenho de janela (sm:) fica intacto", async () => {
    mockTeclado = 320;
    mockVisivel = 480;
    await montar();
    const classes = folha().className.split(/\s+/);
    expect(classes).toContain("bottom-[var(--teclado-da-folha,0px)]");
    expect(classes).toContain(
      "max-h-[min(92dvh,var(--altura-da-folha,92dvh))]",
    );
    // a janela centrada no computador não lê o teclado
    expect(classes).toContain("sm:bottom-auto");
    expect(classes).toContain("sm:max-h-[85dvh]");
    // e nada de `bottom`/`maxHeight` inline, que venceria o `sm:`
    expect(folha().style.bottom).toBe("");
    expect(folha().style.maxHeight).toBe("");
  });

  it("sem teclado, não define variável nenhuma", async () => {
    await montar();
    expect(folha().style.getPropertyValue("--teclado-da-folha")).toBe("");
    expect(folha().style.getPropertyValue("--altura-da-folha")).toBe("");
  });

  it("ao focar a caixa de texto, ela é trazida à vista depois de ~150ms", async () => {
    await montar();
    await irAoPassoDoMotivo();
    const caixa = folha().querySelector<HTMLTextAreaElement>("textarea");
    if (!caixa) throw new Error("caixa de texto não montou");
    const rolar = vi.fn();
    caixa.scrollIntoView = rolar;
    vi.useFakeTimers();
    act(() => {
      caixa.focus();
    });
    expect(rolar).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(rolar).toHaveBeenCalledWith({ block: "nearest" });
  });
});
