// @vitest-environment jsdom
//
// Ordem do dono (22/10/2026): no painel, item selecionado e botão principal
// não usam o dourado de marca. Selecionado = contorno forte neutro + marca de
// "check"; botão principal = fundo neutro de alto contraste. Dourado só no
// "Finalizar Pedido" da loja e no tracinho da aba ativa da barra de baixo.
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import postcss from "postcss";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const require = createRequire(import.meta.url);
const tailwindcss = require("tailwindcss");

function carregarConfigDoProjeto() {
  const caminho = resolve(__dirname, "../../tailwind.config.js");
  const modulo = new (Module as any)(caminho);
  modulo.filename = caminho;
  modulo.paths = (Module as any)._nodeModulePaths(dirname(caminho));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do config do próprio projeto
  modulo._compile(readFileSync(caminho, "utf-8"), caminho);
  return modulo.exports;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
});

describe("painel — selecionado e botão principal são neutros", () => {
  it("AcaoDoPainel primária: fundo neutro, sem dourado, foco com anel neutro", async () => {
    const { AcaoDoPainel } = await import(
      "@/components/admin/primitivos/AcaoDoPainel"
    );
    await act(async () => {
      raiz.render(<AcaoDoPainel>Salvar</AcaoDoPainel>);
    });
    const b = hospedeiro.querySelector("button")!;
    expect(b.className).toContain("bg-foreground");
    expect(b.className).toContain("text-background");
    expect(b.className).toContain("focus-visible:ring-2");
    expect(b.className).not.toContain("admin-gold");
  });

  it("AlternadorDeTelas: a tela atual é neutra e leva aria-current", async () => {
    const { AlternadorDeTelas } = await import(
      "@/components/admin/primitivos/AlternadorDeTelas"
    );
    await act(async () => {
      raiz.render(<AlternadorDeTelas atual="admin-qa" onNavigate={() => {}} />);
    });
    const atual = hospedeiro.querySelector('[aria-current="page"]')!;
    expect(atual).toBeTruthy();
    expect(atual.className).toContain("bg-foreground");
    expect(hospedeiro.innerHTML).not.toContain("admin-gold");
  });

  it("EstadoVazio: o botão da ação é neutro", async () => {
    const { EstadoVazio } = await import(
      "@/components/admin/primitivos/EstadoVazio"
    );
    await act(async () => {
      raiz.render(
        <EstadoVazio
          titulo="Nada"
          frase="Vazio"
          acao={{ rotulo: "Criar", aoClicar: () => {} }}
        />,
      );
    });
    expect(hospedeiro.innerHTML).not.toContain("admin-gold");
    expect(hospedeiro.querySelector("button")!.className).toContain(
      "bg-foreground",
    );
  });

  it("OpcoesDaBusca: a opção selecionada tem contorno forte neutro e um check, sem dourado", async () => {
    const { OpcoesDaBusca } = await import("@/components/admin/BarraDeBusca");
    await act(async () => {
      raiz.render(
        <OpcoesDaBusca
          opcoes={[
            {
              valor: "a",
              rotulo: "Alfa",
              selecionada: true,
              onClick: () => {},
            },
            {
              valor: "b",
              rotulo: "Beta",
              selecionada: false,
              onClick: () => {},
            },
          ]}
        />,
      );
    });
    const [sel, nao] = Array.from(hospedeiro.querySelectorAll("button"));
    expect(sel.getAttribute("aria-pressed")).toBe("true");
    expect(sel.className).toContain("border-foreground");
    expect(sel.className).toContain("border-solid");
    expect(sel.className).not.toContain("admin-gold");
    expect(sel.querySelector('svg[data-marca="selecionado"]')).toBeTruthy();
    expect(nao.querySelector('svg[data-marca="selecionado"]')).toBeNull();
  });
});

describe("painel — as classes neutras geram CSS", () => {
  it("compila o Tailwind do projeto e acha regra para cada uma", async () => {
    const classes = [
      "bg-foreground",
      "text-background",
      "hover:opacity-90",
      "border-foreground",
      "border-solid",
      "ring-1",
      "ring-foreground",
      "bg-admin-hover",
      "text-foreground",
      "focus-visible:ring-ring",
      "focus-visible:ring-offset-admin-nav",
    ];
    const resultado = await postcss([
      tailwindcss({
        ...carregarConfigDoProjeto(),
        content: [{ raw: classes.join(" "), extension: "html" }],
      }),
    ]).process("@tailwind utilities;", { from: undefined });
    const escapar = (t: string) => t.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    expect(
      classes.filter((c) => !resultado.css.includes(`.${escapar(c)}`)),
    ).toEqual([]);
  });
});

describe("Pedidos — filtro escolhido é neutro", () => {
  it("a fonte não pinta o filtro escolhido de dourado", () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo de um arquivo do próprio projeto
    const fonte = readFileSync(
      resolve(__dirname, "../../src/views/admin/AdminOrdersView.tsx"),
      "utf-8",
    );
    expect(fonte).not.toContain("admin-gold");
  });
});
