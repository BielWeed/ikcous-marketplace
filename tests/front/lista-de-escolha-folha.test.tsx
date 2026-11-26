// @vitest-environment jsdom
//
// No celular (sem `matchMedia` de computador) a lista sobe como folha de
// baixo: Radix Dialog com alça, título e Fechar, acima de todas as folhas do
// painel (z-[135]). A busca NÃO recebe foco ao abrir (o teclado cobriria a
// lista). Escolher chama `aoMudar` uma vez, fecha e devolve o foco ao campo.
// Abrir e escolher são no `click`: o dedo que rola não abre nem escolhe (0.10).
// O Voltar do aparelho fecha só a lista.
import { CampoDeEscolha } from "@/components/admin/primitivos/lista-de-escolha/CampoDeEscolha";
import type { OpcaoDaLista } from "@/components/admin/primitivos/lista-de-escolha/tipos";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

const PARCELAS: OpcaoDaLista[] = Array.from({ length: 12 }, (_, i) => ({
  valor: String(i + 1),
  rotulo: `${i + 1}x`,
  ...(i === 0 ? { subinfo: "à vista" } : {}),
}));

function montar(opcoes: readonly OpcaoDaLista[] = PARCELAS, valor = "12") {
  const aoMudar = vi.fn();
  act(() => {
    raiz.render(
      <CampoDeEscolha
        id="parcelas"
        rotulo="Parcelar em até"
        opcoes={opcoes}
        valor={valor}
        aoMudar={aoMudar}
      />,
    );
  });
  return aoMudar;
}

const botao = () => document.getElementById("parcelas") as HTMLButtonElement;
const folha = () =>
  document.querySelector<HTMLElement>('[data-lista-de-escolha="folha"]');
const opcao = (valor: string) =>
  document.querySelector<HTMLElement>(
    `[role="option"][data-valor="${valor}"]`,
  ) as HTMLElement;
const ponteiro = (alvo: Element, tipo: string) =>
  act(() => {
    alvo.dispatchEvent(
      new MouseEvent(tipo, { bubbles: true, cancelable: true, clientY: 10 }),
    );
  });

// O Radix devolve o foco num `setTimeout(0)` depois de desmontar a folha.
const proximoTique = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

function abrir() {
  act(() => botao().click());
  expect(folha()).not.toBeNull();
}

describe("lista de escolha — folha do celular", () => {
  it("abre no clique como diálogo nomeado pelo título, com alça e Fechar", () => {
    montar();
    abrir();
    const dialogo = folha() as HTMLElement;
    expect(dialogo.getAttribute("role")).toBe("dialog");
    const titulo = document.getElementById(
      dialogo.getAttribute("aria-labelledby") ?? "",
    );
    expect(titulo?.textContent).toBe("Parcelar em até");
    expect(dialogo.querySelector('[data-testid="folha-alca"]')).not.toBeNull();
    expect(dialogo.querySelector('button[aria-label="Fechar"]')).not.toBeNull();
    expect(botao().getAttribute("aria-expanded")).toBe("true");
  });

  it("tituloDaLista troca o título da folha", () => {
    act(() => {
      raiz.render(
        <CampoDeEscolha
          id="parcelas"
          rotulo="Parcelas"
          tituloDaLista="Parcelar em até"
          opcoes={PARCELAS}
          valor="1"
          aoMudar={() => {}}
        />,
      );
    });
    abrir();
    expect(folha()?.textContent).toContain("Parcelar em até");
  });

  it("fica na camada 135: acima da FolhaFinanceira (130) e abaixo do aviso (140)", () => {
    montar();
    abrir();
    expect(folha()?.className).toContain("z-[135]");
    const veu = document.querySelector('[data-lista-de-escolha="veu"]');
    expect(veu?.className).toContain("z-[135]");
  });

  it("com busca, a busca NÃO recebe foco ao abrir", () => {
    montar();
    abrir();
    const busca = document.querySelector('[role="combobox"]');
    expect(busca).not.toBeNull();
    expect(document.activeElement).not.toBe(busca);
    expect(folha()?.contains(document.activeElement)).toBe(true);
  });

  it("sem busca, o foco vai para o listbox (o teclado anda nele)", () => {
    montar(PARCELAS.slice(0, 4), "2");
    abrir();
    expect(document.activeElement?.getAttribute("role")).toBe("listbox");
  });

  it("escolher chama aoMudar uma vez, fecha e devolve o foco ao campo", async () => {
    const aoMudar = montar();
    abrir();
    act(() => opcao("3").click());
    expect(aoMudar).toHaveBeenCalledTimes(1);
    expect(aoMudar).toHaveBeenCalledWith("3");
    expect(folha()).toBeNull();
    await proximoTique();
    expect(document.activeElement).toBe(botao());
    expect(botao().getAttribute("aria-expanded")).toBe("false");
  });

  it("escolher a mesma opção fecha sem chamar aoMudar (como o select nativo)", () => {
    const aoMudar = montar();
    abrir();
    act(() => opcao("12").click());
    expect(aoMudar).not.toHaveBeenCalled();
    expect(folha()).toBeNull();
  });

  it("Fechar e Esc fecham sem escolher e devolvem o foco", async () => {
    const aoMudar = montar();
    abrir();
    act(() =>
      folha()
        ?.querySelector<HTMLButtonElement>('button[aria-label="Fechar"]')
        ?.click(),
    );
    expect(folha()).toBeNull();
    await proximoTique();
    expect(document.activeElement).toBe(botao());
    abrir();
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(folha()).toBeNull();
    expect(aoMudar).not.toHaveBeenCalled();
  });

  it("o Voltar do aparelho fecha só a lista", async () => {
    // Quem fechou a lista nos testes anteriores pediu `history.back()`, e o
    // gancho do Voltar ignora todo popstate enquanto um desses retornos está
    // pendente — até 500ms (`JANELA_DO_RETORNO_MS`). Medido aqui: esperar
    // 30ms não basta, 550ms basta. Sem a espera, o Voltar abaixo seria
    // tomado por retorno e a lista não fecharia.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 550));
    });
    const aoMudar = montar();
    abrir();
    // Abrir empurrou a entrada própria da lista no histórico.
    expect(history.state?.folhaDePolitica).toBe(true);
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    expect(folha()).toBeNull();
    expect(aoMudar).not.toHaveBeenCalled();
  });
});

describe("lista de escolha — toque (0.10)", () => {
  it("pointerdown/pointermove no campo, sem click, não abre", () => {
    montar();
    ponteiro(botao(), "pointerdown");
    ponteiro(botao(), "pointermove");
    ponteiro(botao(), "pointerup");
    expect(folha()).toBeNull();
    expect(botao().getAttribute("aria-expanded")).toBe("false");
  });

  it("o dedo que rola a lista (pointerdown/move/up sem click) não escolhe", () => {
    const aoMudar = montar();
    abrir();
    ponteiro(opcao("5"), "pointerdown");
    ponteiro(opcao("5"), "pointermove");
    ponteiro(opcao("5"), "pointerup");
    expect(aoMudar).not.toHaveBeenCalled();
    expect(folha()).not.toBeNull();
  });
});
