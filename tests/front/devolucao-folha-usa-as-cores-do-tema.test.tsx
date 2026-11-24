// @vitest-environment jsdom
//
// A folha de devolução da vitrine tinha `bg-white` e textos zinc fixos: na loja
// com tema escuro ela abria BRANCA no meio de uma tela escura (e, trocando só o
// fundo, o texto cinza escuro ficaria ilegível). Agora usa os tokens do tema
// (`bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`),
// que no tema claro valem as mesmas cores de antes.
//
// O jsdom não pinta: o contrato provado é "nenhuma classe de cor fixa sobrou".
// Duas frentes: (1) o DOM renderizado nos passos 1 e 2; (2) o arquivo-fonte
// inteiro, que cobre o que o DOM não alcança aqui (passos 3 e 4, a tela de
// sucesso e a pergunta de descartar).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
vi.mock("@/hooks/useAlturaDoTeclado", () => ({
  useAlturaDoTeclado: () => ({ altura: 0, alturaVisivel: 0 }),
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

// Cor fixa de tema claro: branco/zinc em fundo, texto, borda, anel ou placeholder.
const COR_FIXA =
  /(?:^|[\s:])(?:bg-white|(?:bg|text|border|ring|divide|placeholder:text)-zinc-\d+(?:\/\d+)?)(?=$|\s)/;

function classesComCorFixa(raizDoDom: ParentNode): string[] {
  return Array.from(raizDoDom.querySelectorAll("[class]"))
    .map((el) => el.getAttribute("class") ?? "")
    .filter((c) => COR_FIXA.test(c));
}

describe("folha de devolução da vitrine: cores do tema, não branco fixo", () => {
  it("controle: a regex enxerga cor fixa em classe de verdade", () => {
    expect(COR_FIXA.test("rounded-2xl bg-white p-3")).toBe(true);
    expect(COR_FIXA.test("text-zinc-500 text-xs")).toBe(true);
    expect(COR_FIXA.test("hover:border-zinc-400")).toBe(true);
    expect(COR_FIXA.test("dark:bg-zinc-900")).toBe(true);
    expect(COR_FIXA.test("bg-background text-foreground")).toBe(false);
  });

  it("a folha em si usa o fundo e o texto do tema", async () => {
    await montar();
    const classes = folha().className.split(/\s+/);
    expect(classes).toContain("bg-background");
    expect(classes).toContain("text-foreground");
    expect(classes).not.toContain("bg-white");
  });

  it("passo 1 (itens) e passo 2 (motivo) não têm cor fixa em nenhum elemento", async () => {
    await montar();
    expect(classesComCorFixa(folha())).toEqual([]);
    await clicar(botao("Aumentar Tênis"));
    await clicar(botao("Continuar"));
    expect(folha().querySelector("textarea")).not.toBeNull();
    expect(classesComCorFixa(folha())).toEqual([]);
  });

  it("o arquivo inteiro (passos 3 e 4, sucesso, pergunta de descartar) também não", () => {
    const fonte = readFileSync(
      resolve("src/components/devolucao/SolicitarDevolucaoSheet.tsx"),
      "utf8",
    );
    const sobras = fonte
      .split("\n")
      .map((linha, i) => ({ linha, n: i + 1 }))
      // `text-white` sobre o `bg-black/60` do botão de remover foto fica: é
      // ícone sobre a foto, não superfície do tema.
      .filter(({ linha }) =>
        /(?:^|[\s"'`:])(?:bg-white|(?:bg|text|border|ring|divide|placeholder:text)-zinc-\d+(?:\/\d+)?)(?=$|[\s"'`])/.test(
          linha,
        ),
      );
    expect(sobras).toEqual([]);
  });
});
