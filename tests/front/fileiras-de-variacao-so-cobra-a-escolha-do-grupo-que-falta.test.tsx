// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026), FileirasDeVariacao. A cobrança "Escolha" em vermelho e o
// `aria-describedby` do grupo só existem para o grupo que a cliente tentou comprar SEM
// escolher: ele está na lista de `pendentes` E ainda não tem escolha. Um grupo já escolhido
// (mesmo que conste na lista) e um grupo fora da lista (mesmo sem escolha) ficam quietos;
// sem isso, o leitor de tela cobria o que já estava feito e a tela pintava de erro o que
// ninguém tentou comprar.
import { FileirasDeVariacao } from "@/components/ui/custom/FileirasDeVariacao";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fileiras = [
  {
    nome: "Tamanho",
    valores: [
      { valor: "P", disponivel: true, estoque: 3 },
      { valor: "M", disponivel: true, estoque: 3 },
    ],
  },
  {
    nome: "Modelo",
    valores: [
      { valor: "Liso", disponivel: true, estoque: 3 },
      { valor: "Listrado", disponivel: true, estoque: 3 },
    ],
  },
  {
    nome: "Estampa",
    valores: [{ valor: "Flor", disponivel: true, estoque: 3 }],
  },
];

describe("FileirasDeVariacao: só o grupo pendente e sem escolha é cobrado", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
  });

  function desenhar(escolha: Record<string, string>, pendentes?: string[]) {
    act(() => {
      raiz.render(
        <FileirasDeVariacao
          fileiras={fileiras}
          escolha={escolha}
          onEscolher={() => {}}
          pendentes={pendentes}
        />,
      );
    });
  }
  const grupo = (nome: string) =>
    [...host.querySelectorAll<HTMLElement>('[role="group"]')].find(
      (g) =>
        g.querySelector(`[id="${g.getAttribute("aria-labelledby")}"]`)
          ?.textContent === nome,
    ) as HTMLElement;
  /** O texto da direita ("Escolha" ou o valor escolhido) do grupo. */
  const valorDoGrupo = (nome: string) =>
    grupo(nome).querySelector<HTMLElement>(
      `[id^="${(grupo(nome).getAttribute("aria-labelledby") ?? "").replace(/-\d+$/, "")}-escolha-"]`,
    ) as HTMLElement;
  const descrito = (nome: string) =>
    grupo(nome).getAttribute("aria-describedby");

  it("grupo pendente e sem escolha: aponta para o 'Escolha' e o pinta de alerta", () => {
    desenhar({}, ["Tamanho"]);
    const aviso = valorDoGrupo("Tamanho");
    expect(aviso.textContent).toBe("Escolha");
    expect(descrito("Tamanho")).toBe(aviso.id);
    expect(aviso.className).toContain("text-red-700");
  });

  it("grupo pendente que JÁ tem escolha: sem descrição e sem alerta", () => {
    desenhar({ Tamanho: "P" }, ["Tamanho"]);
    const valor = valorDoGrupo("Tamanho");
    expect(valor.textContent).toBe("P");
    expect(descrito("Tamanho")).toBeNull();
    expect(valor.className).not.toContain("text-red-700");
  });

  it("grupo sem escolha que NÃO está na lista: sem descrição e 'Escolha' em cinza", () => {
    desenhar({}, ["Tamanho"]);
    const aviso = valorDoGrupo("Modelo");
    expect(aviso.textContent).toBe("Escolha");
    expect(descrito("Modelo")).toBeNull();
    expect(aviso.className).not.toContain("text-red-700");
    expect(aviso.className).toContain("text-muted-foreground");
  });

  it("sem lista de pendentes, nenhum grupo é descrito nem pintado de alerta", () => {
    desenhar({ Estampa: "Flor" });
    for (const nome of ["Tamanho", "Modelo", "Estampa"]) {
      expect(descrito(nome)).toBeNull();
      expect(valorDoGrupo(nome).className).not.toContain("text-red-700");
    }
  });

  it("vários pendentes: cada grupo aponta para o SEU próprio aviso", () => {
    desenhar({ Estampa: "Flor" }, ["Tamanho", "Modelo", "Estampa"]);
    const ids = ["Tamanho", "Modelo"].map((n) => descrito(n));
    expect(ids[0]).toBe(valorDoGrupo("Tamanho").id);
    expect(ids[1]).toBe(valorDoGrupo("Modelo").id);
    expect(ids[0]).not.toBe(ids[1]);
    expect(descrito("Estampa")).toBeNull();
  });
});
