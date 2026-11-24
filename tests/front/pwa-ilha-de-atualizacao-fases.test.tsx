// @vitest-environment jsdom
// O que a cápsula de atualização mostra em CADA fase. Os testes existentes
// provam "instalando", "concluída" e o painel aguardando; faltava o aviso de
// "pendente" (a atualização que não conseguiu concluir sozinha), que o spinner
// só gire enquanto instala, que o verde seja só do "pronto" e que o texto longo
// do pendente não estoure a barra.
import {
  IlhaDeAtualizacao,
  useIlhaDeAtualizacaoAtiva,
} from "@/components/pwa/IlhaDeAtualizacao";
import {
  type FaseDaAtualizacao,
  definirEstadoDaAtualizacao,
} from "@/lib/atualizacao/estado-da-atualizacao";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ilha da atualização — cada fase", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
    host.remove();
    vi.useRealTimers();
  });

  function montar(fase: FaseDaAtualizacao, variante?: "cliente" | "painel") {
    definirEstadoDaAtualizacao({ fase, versaoNova: null });
    act(() => raiz.render(<IlhaDeAtualizacao variante={variante} />));
    const capsula = host.querySelector('[role="status"] > span');
    const icone = host.querySelector('svg[aria-hidden="true"]');
    return {
      texto: host.textContent,
      classeDaCapsula: capsula?.getAttribute("class") ?? "",
      classeDoIcone: icone?.getAttribute("class") ?? "",
    };
  }

  it.each(["cliente", "painel"] as const)(
    "atualização pendente avisa que não concluiu sozinha (%s)",
    (variante) => {
      const { texto } = montar("pendente", variante);
      expect(texto).toBe(
        "Atualização pendente — não foi possível concluir automaticamente",
      );
    },
  );

  it("o texto longo do pendente tem largura limitada; nas outras fases, não", () => {
    expect(montar("pendente").classeDaCapsula).toContain(
      "max-w-[min(9rem,40vw)]",
    );
    act(() => raiz.render(null));
    expect(montar("instalando").classeDaCapsula).not.toContain(
      "max-w-[min(9rem,40vw)]",
    );
  });

  it("o ícone gira só enquanto instala", () => {
    const instalando = montar("instalando");
    expect(instalando.classeDoIcone).toContain("animate-spin");
    for (const fase of ["concluida", "pendente"] as const) {
      act(() => raiz.render(null));
      expect(montar(fase).classeDoIcone).not.toContain("animate-spin");
    }
    act(() => raiz.render(null));
    expect(montar("aguardando", "painel").classeDoIcone).not.toContain(
      "animate-spin",
    );
  });

  it("o verde é só do 'pronto'; instalando, pendente e aguardando ficam neutros", () => {
    expect(montar("concluida").classeDoIcone).toContain("text-emerald-300");
    for (const fase of ["instalando", "pendente"] as const) {
      act(() => raiz.render(null));
      const { classeDoIcone } = montar(fase);
      expect(classeDoIcone).toContain("text-zinc-200");
      expect(classeDoIcone).not.toContain("text-emerald-300");
    }
  });

  it("fase 'nenhuma' não desenha cápsula nem ícone", () => {
    const { texto, classeDaCapsula, classeDoIcone } = montar("nenhuma");
    expect(texto).toBe("");
    expect(classeDaCapsula).toBe("");
    expect(classeDoIcone).toBe("");
  });
});

describe("useIlhaDeAtualizacaoAtiva — quando o espaço da cápsula existe", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  let ativa: boolean | undefined;

  function Sonda({
    variante,
    aoLer,
  }: {
    variante: "cliente" | "painel";
    aoLer: (valor: boolean) => void;
  }) {
    aoLer(useIlhaDeAtualizacaoAtiva(variante));
    return null;
  }

  beforeEach(() => {
    ativa = undefined;
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
    host.remove();
  });

  it.each([
    ["nenhuma", "cliente", false],
    ["aguardando", "cliente", false],
    ["pendente", "cliente", false],
    ["instalando", "cliente", true],
    ["concluida", "cliente", true],
    ["nenhuma", "painel", false],
    ["aguardando", "painel", true],
    ["pendente", "painel", false],
    ["instalando", "painel", true],
    ["concluida", "painel", true],
  ] as const)("fase %s, variante %s: ativa=%s", (fase, variante, esperado) => {
    definirEstadoDaAtualizacao({ fase, versaoNova: null });
    act(() =>
      raiz.render(
        <Sonda
          variante={variante}
          aoLer={(valor) => {
            ativa = valor;
          }}
        />,
      ),
    );
    expect(ativa).toBe(esperado);
  });
});
