// @vitest-environment jsdom
//
// A conexão na barra do painel (ConexaoDoPainel) tem regras próprias que os
// testes de casca e de tema só tocam no caminho feliz:
//   - qual estado manda quando dois valem ao mesmo tempo (sem internet vence
//     "sincronizado", que vence "lenta");
//   - o que é "anormal" (a palavra ganha a cor do estado): offline, sincronizado
//     e lenta — e só esses; boa/excelente deixam o cinza de apoio;
//   - a cor da bolinha: boa = azul, excelente = verde (mesmo sem rótulo novo);
//   - o pulso (`animate-pulse`) é só do "sincronizado", na bolinha e na palavra;
//   - o nome com mais de 26 letras encolhe a fonte; com 26 exatas, não;
//   - Escape: fecha só quando está aberto — fechado, o Escape SEGUE para quem
//     está acima (um diálogo ou a barra); aberto, o Escape para aqui;
//   - o nome acessível diz o nome da loja (se houver) e o estado.
import type { EstadoDeOperacao } from "@/components/admin/PontoDeOperacao";
import { ConexaoDoPainel } from "@/components/layouts/ConexaoDoPainel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const base: EstadoDeOperacao = {
  isOffline: false,
  quality: "excellent",
  latency: 80,
  showSyncFlash: false,
};

describe("ConexaoDoPainel — estados, limites e teclado", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function montar(estado: EstadoDeOperacao, nome?: string) {
    act(() => root.render(<ConexaoDoPainel estado={estado} nome={nome} />));
    return host.querySelector<HTMLButtonElement>("button")!;
  }
  const classes = (el: Element | null | undefined) =>
    (el?.getAttribute("class") ?? "").split(/\s+/);

  /** A bolinha de estado (modo com nome) é o único span aria-hidden do botão. */
  const bolinha = (b: HTMLElement) =>
    b.querySelector<HTMLElement>('span[aria-hidden="true"]');
  /** A palavra "Estado · Admin" (modo com nome): o span mais interno que a diz. */
  const palavraComNome = (b: HTMLElement) =>
    Array.from(b.querySelectorAll("span"))
      .filter((s) => s.textContent?.includes("· Admin"))
      .at(-1)!;
  /** O rótulo no modo sem nome: o span com `title` do estado. */
  const palavraSemNome = (b: HTMLElement) =>
    b.querySelector<HTMLElement>("span[title]")!;

  describe("qual estado manda quando dois valem juntos", () => {
    it("sem internet vence 'sincronizado'", () => {
      const botao = montar(
        { ...base, isOffline: true, quality: "offline", showSyncFlash: true },
        "Loja Aurora",
      );
      expect(botao.textContent).toContain("Sem internet · Admin");
      expect(botao.title).toBe("Sem conexão com o servidor");
    });

    it("sem internet vence 'lenta'", () => {
      const botao = montar(
        { ...base, isOffline: true, quality: "slow" },
        "Loja Aurora",
      );
      expect(botao.textContent).toContain("Sem internet · Admin");
    });

    it("'sincronizado' vence 'lenta'", () => {
      const botao = montar(
        { ...base, quality: "slow", showSyncFlash: true },
        "Loja Aurora",
      );
      expect(botao.textContent).toContain("Sincronizado · Admin");
      expect(botao.title).toBe("Sincronização concluída!");
    });

    it("qualquer outra combinação sem alerta cai em 'Online'", () => {
      expect(montar({ ...base, quality: "offline" }, "Loja Aurora").title).toBe(
        "Conexão boa",
      );
    });
  });

  describe("cor da bolinha por qualidade", () => {
    it.each([
      ["good", "text-sky-300"],
      ["excellent", "text-emerald-400"],
    ] as const)("qualidade %s -> %s", (quality, cor) => {
      const ponto = bolinha(montar({ ...base, quality }, "Loja Aurora"));
      expect(classes(ponto)).toContain(cor);
      const outra =
        cor === "text-sky-300" ? "text-emerald-400" : "text-sky-300";
      expect(classes(ponto)).not.toContain(outra);
    });
  });

  describe("o que é 'anormal' pinta a palavra; o normal não", () => {
    it.each([
      [
        "sem internet",
        { ...base, isOffline: true, quality: "offline" },
        "text-red-400",
      ],
      ["sincronizado", { ...base, showSyncFlash: true }, "text-emerald-400"],
      ["lenta", { ...base, quality: "slow" }, "text-orange-300"],
    ] as const)(
      "%s: a palavra ganha %s (com e sem nome)",
      (_n, estado, cor) => {
        expect(
          classes(palavraComNome(montar(estado, "Loja Aurora"))),
        ).toContain(cor);
        act(() => root.unmount());
        root = createRoot(host);
        expect(classes(palavraSemNome(montar(estado)))).toContain(cor);
      },
    );

    it.each(["excellent", "good"] as const)(
      "qualidade %s: a palavra NÃO ganha cor de estado (com e sem nome)",
      (quality) => {
        const comNome = palavraComNome(
          montar({ ...base, quality }, "Loja Aurora"),
        );
        expect(comNome.getAttribute("class") ?? "").not.toMatch(
          /text-(emerald|sky|orange|red)/,
        );
        act(() => root.unmount());
        root = createRoot(host);
        const semNome = palavraSemNome(montar({ ...base, quality }));
        expect(semNome.getAttribute("class") ?? "").not.toMatch(
          /text-(emerald|sky|orange|red)/,
        );
      },
    );
  });

  describe("o pulso é só do 'sincronizado'", () => {
    it("sincronizado: bolinha e palavra pulsam (com nome)", () => {
      const botao = montar({ ...base, showSyncFlash: true }, "Loja Aurora");
      expect(classes(bolinha(botao))).toContain("animate-pulse");
      expect(classes(palavraComNome(botao))).toContain("animate-pulse");
    });

    it("sincronizado: a palavra pulsa também sem nome", () => {
      const botao = montar({ ...base, showSyncFlash: true });
      expect(classes(palavraSemNome(botao))).toContain("animate-pulse");
    });

    it.each([
      ["excelente", base],
      ["lenta", { ...base, quality: "slow" as const }],
      [
        "sem internet",
        { ...base, isOffline: true, quality: "offline" as const },
      ],
    ])("%s: nada pulsa", (_n, estado) => {
      const comNome = montar(estado, "Loja Aurora");
      expect(comNome.innerHTML).not.toContain("animate-pulse");
      act(() => root.unmount());
      root = createRoot(host);
      expect(montar(estado).innerHTML).not.toContain("animate-pulse");
    });
  });

  describe("nome da loja: a fonte encolhe acima de 26 letras", () => {
    const nomeDe = (n: number) => "A".repeat(n);
    // O span do nome é o que quebra linha e carrega o texto + a seta.
    const elementoDoNome = (b: HTMLElement, nome: string) => {
      const el = b.querySelector<HTMLElement>("span.break-words")!;
      expect(el.textContent).toBe(nome);
      return el;
    };

    it("26 letras exatas: fonte normal (15/17 px)", () => {
      const nome = nomeDe(26);
      const el = elementoDoNome(montar(base, nome), nome);
      expect(classes(el)).toContain("text-[15px]");
      expect(classes(el)).not.toContain("text-[14px]");
    });

    it("27 letras: fonte menor (14 px)", () => {
      const nome = nomeDe(27);
      const el = elementoDoNome(montar(base, nome), nome);
      expect(classes(el)).toContain("text-[14px]");
      expect(classes(el)).not.toContain("text-[15px]");
    });

    it("1 letra: fonte normal", () => {
      const el = elementoDoNome(montar(base, "A"), "A");
      expect(classes(el)).toContain("text-[15px]");
    });
  });

  describe("nome acessível e modo da casca", () => {
    it("com nome: 'Nome Admin, conexão Estado. Detalhes da conexão'", () => {
      const botao = montar({ ...base, quality: "slow" }, "Loja Aurora");
      expect(botao.getAttribute("aria-label")).toBe(
        "Loja Aurora Admin, conexão Lenta. Detalhes da conexão",
      );
    });

    it("sem nome: não sobra espaço nem 'undefined' no começo", () => {
      const botao = montar(base);
      expect(botao.getAttribute("aria-label")).toBe(
        "Admin, conexão Online. Detalhes da conexão",
      );
    });

    it("sem nome: a raiz é 'relative' (o painel ancora nela) e o botão é a caixinha; com nome, não", () => {
      montar(base);
      expect(classes(host.firstElementChild)).toContain("relative");
      expect(classes(host.querySelector("button"))).toContain("border");
      act(() => root.unmount());
      root = createRoot(host);
      montar(base, "Loja Aurora");
      expect(classes(host.firstElementChild)).not.toContain("relative");
      expect(classes(host.querySelector("button"))).not.toContain("border");
    });

    it("o painel aberto ancora em toda a largura sem nome e recuado com nome", () => {
      const semNome = montar(base);
      act(() => semNome.click());
      const painelSem = document.getElementById(
        semNome.getAttribute("aria-controls")!,
      );
      expect(classes(painelSem)).toContain("inset-x-0");
      expect(classes(painelSem)).not.toContain("inset-x-5");
      act(() => root.unmount());
      root = createRoot(host);

      const comNome = montar(base, "Loja Aurora");
      act(() => comNome.click());
      const painelCom = document.getElementById(
        comNome.getAttribute("aria-controls")!,
      );
      expect(classes(painelCom)).toContain("inset-x-5");
      expect(classes(painelCom)).not.toContain("inset-x-0");
    });

    it("sem nome o rótulo é só o estado, sem '· Admin'", () => {
      expect(montar({ ...base, quality: "slow" }).textContent).toBe("Lenta");
    });
  });

  describe("abrir, fechar e o teclado", () => {
    it("clicar duas vezes abre e fecha; a seta gira só aberta (sem nome)", () => {
      const botao = montar(base);
      const seta = () => {
        const svgs = botao.querySelectorAll("svg");
        return svgs[svgs.length - 1];
      };
      expect(classes(seta())).not.toContain("rotate-180");
      act(() => botao.click());
      expect(botao.getAttribute("aria-expanded")).toBe("true");
      expect(classes(seta())).toContain("rotate-180");
      expect(
        document.getElementById(botao.getAttribute("aria-controls")!),
      ).not.toBeNull();
      act(() => botao.click());
      expect(botao.getAttribute("aria-expanded")).toBe("false");
      expect(classes(seta())).not.toContain("rotate-180");
      expect(
        document.getElementById(botao.getAttribute("aria-controls")!),
      ).toBeNull();
    });

    it("com nome: a seta ao lado do nome gira só aberta", () => {
      const botao = montar(base, "Loja Aurora");
      const seta = () => botao.querySelector("span.break-words svg");
      expect(classes(seta())).not.toContain("rotate-180");
      act(() => botao.click());
      expect(classes(seta())).toContain("rotate-180");
      act(() => botao.click());
      expect(classes(seta())).not.toContain("rotate-180");
    });

    it("o botão Fechar do painel (toque) fecha e devolve o foco à conexão", () => {
      const botao = montar(base, "Loja Aurora");
      act(() => botao.click());
      const fechar = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Fechar detalhes da conexão"]',
      );
      expect(fechar).not.toBeNull();
      act(() => fechar?.click());
      expect(botao.getAttribute("aria-expanded")).toBe("false");
      expect(
        document.getElementById(botao.getAttribute("aria-controls")!),
      ).toBeNull();
      expect(document.activeElement).toBe(botao);
    });

    it("fechado: o Escape SEGUE para quem está acima (não é engolido)", () => {
      const acima = vi.fn();
      document.body.addEventListener("keydown", acima);
      const botao = montar(base, "Loja Aurora");
      act(() => {
        botao.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
      expect(acima).toHaveBeenCalledTimes(1);
      expect(botao.getAttribute("aria-expanded")).toBe("false");
      document.body.removeEventListener("keydown", acima);
    });

    it("aberto: o Escape fecha e NÃO sobe para quem está acima", () => {
      const acima = vi.fn();
      document.body.addEventListener("keydown", acima);
      const botao = montar(base, "Loja Aurora");
      act(() => botao.click());
      act(() => {
        botao.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
      expect(botao.getAttribute("aria-expanded")).toBe("false");
      expect(acima).not.toHaveBeenCalled();
      document.body.removeEventListener("keydown", acima);
    });

    it("aberto: outra tecla não fecha nem para a subida", () => {
      const acima = vi.fn();
      document.body.addEventListener("keydown", acima);
      const botao = montar(base, "Loja Aurora");
      act(() => botao.click());
      act(() => {
        botao.dispatchEvent(
          new KeyboardEvent("keydown", { key: "a", bubbles: true }),
        );
      });
      expect(botao.getAttribute("aria-expanded")).toBe("true");
      expect(acima).toHaveBeenCalledTimes(1);
      document.body.removeEventListener("keydown", acima);
    });

    it("Escape com o foco no botão Fechar do painel também fecha e devolve o foco à conexão", () => {
      const acima = vi.fn();
      document.body.addEventListener("keydown", acima);
      const botao = montar(base, "Loja Aurora");
      act(() => botao.click());
      const fechar = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Fechar detalhes da conexão"]',
      )!;
      fechar.focus();
      act(() => {
        fechar.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
      expect(botao.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(botao);
      expect(acima).not.toHaveBeenCalled();
      document.body.removeEventListener("keydown", acima);
    });
  });

  describe("o painel de detalhes", () => {
    const abrir = (estado: EstadoDeOperacao, nome?: string) => {
      const botao = montar(estado, nome);
      act(() => botao.click());
      return document.getElementById(botao.getAttribute("aria-controls")!)!;
    };

    it("sem internet: título 'Reconexão automática' e o ícone de recarregar", () => {
      const painel = abrir({ ...base, isOffline: true, quality: "offline" });
      expect(painel.textContent).toContain("Reconexão automática");
      expect(painel.textContent).not.toContain("Sem conexão com o servidor");
      expect(painel.querySelector("svg.lucide-refresh-cw")).not.toBeNull();
      expect(painel.querySelector("svg.lucide-wifi-off")).toBeNull();
    });

    it("com internet: título do estado e o ícone do estado, sem o de recarregar", () => {
      const painel = abrir({ ...base, quality: "slow" });
      expect(painel.textContent).toContain("Conexão lenta");
      expect(painel.querySelector("svg.lucide-clock")).not.toBeNull();
      expect(painel.querySelector("svg.lucide-refresh-cw")).toBeNull();
    });

    it("o painel e o botão se ligam pelo mesmo id", () => {
      const botao = montar(base, "Loja Aurora");
      act(() => botao.click());
      const id = botao.getAttribute("aria-controls")!;
      expect(id).not.toBe("");
      expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
    });
  });
});
