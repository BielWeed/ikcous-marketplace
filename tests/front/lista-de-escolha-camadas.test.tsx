// @vitest-environment jsdom
//
// A lista de escolha mora DENTRO das folhas do painel (FolhaDoPainel, z-100, e
// FolhaFinanceira, z-130), que são Radix Dialog modais. Escolher, tocar fora
// da lista ou apertar Esc fecha SÓ a lista: a folha-mãe continua aberta e o
// `aoFechar` dela não é chamado. Vale no celular (folha) e no computador
// (popover) — é o achado 1 do plano: lista posicionada à mão e jogada no body
// contaria como "fora" da folha e a fecharia.
import { FolhaFinanceira } from "@/components/admin/financeiro/FolhaFinanceira";
import { FolhaDoPainel } from "@/components/admin/primitivos/FolhaDoPainel";
import { CampoDeEscolha } from "@/components/admin/primitivos/lista-de-escolha/CampoDeEscolha";
import type { OpcaoDaLista } from "@/components/admin/primitivos/lista-de-escolha/tipos";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// O hook de verdade arrasta o cliente do Supabase (que exige as variáveis de
// ambiente). A largura vem do mesmo `matchMedia` falso de cada caso.
vi.mock("@/hooks/useFinanceiro", () => ({
  useTelaLarga: () =>
    globalThis.matchMedia?.("(min-width: 1024px)").matches === true,
}));

let raiz: Root;
let hospedeiro: HTMLDivElement;

class ResizeObserverFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function telaDe(computador: boolean) {
  vi.stubGlobal("matchMedia", (consulta: string) => ({
    matches: computador && consulta.includes("min-width: 1024px"),
    media: consulta,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverFalso);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

const CONTAS: OpcaoDaLista[] = [
  { valor: "caixa", rotulo: "Caixa da loja" },
  { valor: "banco", rotulo: "Conta no banco" },
  { valor: "mp", rotulo: "Mercado Pago" },
];

function Conta({ aoMudar }: { readonly aoMudar: (v: string) => void }) {
  const [valor, setValor] = useState("caixa");
  return (
    <CampoDeEscolha
      id="fin-conta"
      rotulo="Conta"
      opcoes={CONTAS}
      valor={valor}
      aoMudar={(v) => {
        setValor(v);
        aoMudar(v);
      }}
    />
  );
}

type Mae = "FolhaDoPainel" | "FolhaFinanceira";

function montar(mae: Mae) {
  const aoFechar = vi.fn();
  const aoMudar = vi.fn();
  act(() => {
    raiz.render(
      mae === "FolhaDoPainel" ? (
        <FolhaDoPainel aberta onFechar={aoFechar} titulo="Nova conta">
          <Conta aoMudar={aoMudar} />
        </FolhaDoPainel>
      ) : (
        <FolhaFinanceira titulo="Novo lançamento" aoFechar={aoFechar}>
          <Conta aoMudar={aoMudar} />
        </FolhaFinanceira>
      ),
    );
  });
  return { aoFechar, aoMudar };
}

const botao = () => document.getElementById("fin-conta") as HTMLButtonElement;
const lista = () =>
  document.querySelector<HTMLElement>(
    '[data-lista-de-escolha="folha"], [data-lista-de-escolha="popover"]',
  );
const tituloDaMae = (mae: Mae) =>
  [...document.querySelectorAll('[role="dialog"]')].find((d) =>
    d.textContent?.includes(
      mae === "FolhaDoPainel" ? "Nova conta" : "Novo lançamento",
    ),
  );

// O Radix só passa a ouvir o toque de fora no tique seguinte à abertura.
const proximoTique = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

async function abrir() {
  await act(async () => botao().click());
  expect(lista()).not.toBeNull();
  await proximoTique();
}

const CASOS = (["FolhaDoPainel", "FolhaFinanceira"] as const).flatMap((mae) =>
  ([false, true] as const).map((computador) => ({
    mae,
    computador,
    nome: `${mae} no ${computador ? "computador" : "celular"}`,
  })),
);

describe.each(CASOS)(
  "lista de escolha dentro da $nome",
  ({ mae, computador }) => {
    beforeEach(() => telaDe(computador));

    it("abre o modo certo", async () => {
      montar(mae);
      await abrir();
      expect(lista()?.dataset.listaDeEscolha).toBe(
        computador ? "popover" : "folha",
      );
    });

    it("escolher fecha só a lista; a folha-mãe fica e não é fechada", async () => {
      const { aoFechar, aoMudar } = montar(mae);
      await abrir();
      await act(async () =>
        document
          .querySelector<HTMLElement>('[role="option"][data-valor="mp"]')
          ?.click(),
      );
      expect(aoMudar).toHaveBeenCalledTimes(1);
      expect(aoMudar).toHaveBeenCalledWith("mp");
      expect(lista()).toBeNull();
      expect(tituloDaMae(mae)).toBeDefined();
      expect(aoFechar).not.toHaveBeenCalled();
      expect(botao().dataset.valor).toBe("mp");
    });

    it("Esc fecha só a lista", async () => {
      const { aoFechar } = montar(mae);
      await abrir();
      await act(async () => {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
      expect(lista()).toBeNull();
      expect(aoFechar).not.toHaveBeenCalled();
      expect(tituloDaMae(mae)).toBeDefined();
      expect(document.activeElement).toBe(botao());
    });

    it("tocar fora da lista (na própria folha-mãe) fecha só a lista", async () => {
      const { aoFechar, aoMudar } = montar(mae);
      await abrir();
      const alvo = tituloDaMae(mae) as HTMLElement;
      await act(async () => {
        alvo.dispatchEvent(
          new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
        );
        alvo.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
        alvo.click();
      });
      expect(lista()).toBeNull();
      expect(aoFechar).not.toHaveBeenCalled();
      expect(aoMudar).not.toHaveBeenCalled();
      expect(tituloDaMae(mae)).toBeDefined();
    });

    it("a lista fica acima da folha-mãe (135 > 130 > 100)", async () => {
      montar(mae);
      await abrir();
      expect(lista()?.className).toContain("z-[135]");
    });
  },
);
