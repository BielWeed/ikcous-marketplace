// @vitest-environment jsdom
//
// Painel simples, tarefa C5 (spec 2026-10-09 §3): Ajustes vira "o lugar da
// loja", em SEIS grupos fixos — Minha loja, Aparência do app, Entrega e
// frete, Pagamentos, Regras de troca e devolução, Ferramentas. O contrato:
//   1. A tela e a ajuda leem os grupos da MESMA constante
//      (`grupos-de-ajustes.ts`): o texto "três grupos" some.
//   2. As portas de dentro dos grupos são as de `PORTAS_DO_PAINEL.ajustes`,
//      com o nome de `NOMES_DO_PAINEL`; a de Frete nasce aqui (a de Produtos
//      sai na frente vizinha).
//   3. Ajustes NÃO tem porta para admin-push (decisão de 30/08/2026, que
//      morava em porta-de-avisar-clientes-mora-em-clientes): banners,
//      vitrines, Minha loja e Frete continuam alcançáveis.
//   4. O acordeão de dentro do grupo "Entrega e frete" chama-se
//      "Transportadoras" (o nome colidia com o do grupo).
//   5. O título da tela vem de NOMES_DO_PAINEL.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GRUPOS_DE_AJUSTES,
  type GrupoDeAjustes,
} from "@/components/admin/settings/grupos-de-ajustes";
import { NOMES_DO_PAINEL, PORTAS_DO_PAINEL } from "@/config/nomes-do-painel";
import type { View } from "@/types";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    isLoaded: true,
    config: { storeCity: "Monte Carmelo", storeState: "MG" },
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        limit: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
    functions: {
      invoke: () => Promise.resolve({ data: null, error: null }),
    },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const GRUPOS_NA_ORDEM = [
  "Minha loja",
  "Aparência do app",
  "Entrega e frete",
  "Pagamentos",
  "Regras de troca e devolução",
  "Ferramentas",
];

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("a constante dos grupos de Ajustes", () => {
  it("tem os seis grupos, na ordem do desenho", () => {
    expect(GRUPOS_DE_AJUSTES.map((g: GrupoDeAjustes) => g.titulo)).toEqual(
      GRUPOS_NA_ORDEM,
    );
  });

  it("as portas dos grupos são exatamente PORTAS_DO_PAINEL.ajustes, sem repetir", () => {
    const portas = GRUPOS_DE_AJUSTES.flatMap((g: GrupoDeAjustes) =>
      g.portas.map((p) => p.tela),
    );
    expect(new Set(portas).size).toBe(portas.length);
    expect([...portas].sort()).toEqual([...PORTAS_DO_PAINEL.ajustes].sort());
  });

  it("Minha loja, Aparência do app e Entrega e frete guardam as portas certas", () => {
    const porGrupo = Object.fromEntries(
      GRUPOS_DE_AJUSTES.map((g: GrupoDeAjustes) => [
        g.titulo,
        g.portas.map((p) => p.tela),
      ]),
    );
    expect(porGrupo["Minha loja"]).toEqual(["admin-about-store"]);
    expect(porGrupo["Aparência do app"]).toEqual([
      "admin-banners",
      "admin-carousels",
    ]);
    expect(porGrupo["Entrega e frete"]).toEqual(["admin-shipping"]);
    expect(porGrupo.Pagamentos).toEqual([]);
    expect(porGrupo["Regras de troca e devolução"]).toEqual([]);
    expect(porGrupo.Ferramentas).toEqual([]);
  });
});

describe("a tela de Ajustes", () => {
  let container: HTMLDivElement;
  let root: Root;
  let idas: View[];

  beforeEach(async () => {
    idas = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const { AdminSettingsView } = await import(
      "@/views/admin/AdminSettingsView"
    );
    await act(async () => {
      root.render(
        <AdminSettingsView
          onNavigate={(view: View) => idas.push(view)}
          active={true}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function titulosDosGrupos(): string[] {
    return [...container.querySelectorAll("h2")]
      .map((h) => h.textContent ?? "")
      .filter((t) => t !== "Como está sua loja");
  }

  function porta(nome: string): Element | undefined {
    return [...container.querySelectorAll('[role="button"]')].find(
      (el) => el.querySelector("h3")?.textContent === nome,
    );
  }

  it("mostra os seis grupos, na ordem da constante", () => {
    expect(titulosDosGrupos()).toEqual(GRUPOS_NA_ORDEM);
    expect(titulosDosGrupos()).toEqual(
      GRUPOS_DE_AJUSTES.map((g: GrupoDeAjustes) => g.titulo),
    );
  });

  it("cada porta mora dentro do grupo da constante, com o nome de NOMES_DO_PAINEL", () => {
    for (const grupo of GRUPOS_DE_AJUSTES) {
      const secao = [...container.querySelectorAll("section")].find(
        (s) => s.querySelector(":scope > h2")?.textContent === grupo.titulo,
      );
      expect(secao, `grupo ${grupo.titulo} ausente`).toBeDefined();
      const nomes = [...secao!.querySelectorAll('[role="button"] h3')].map(
        (h) => h.textContent,
      );
      expect(nomes).toEqual(grupo.portas.map((p) => NOMES_DO_PAINEL[p.tela]));
    }
  });

  it("a porta de Entrega e frete leva a admin-shipping", async () => {
    const cartao = porta("Entrega e frete");
    expect(cartao, "porta 'Entrega e frete' ausente").toBeDefined();
    await act(async () => {
      cartao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(idas).toEqual(["admin-shipping"]);
  });

  it("a porta funciona também pelo teclado (Enter)", async () => {
    const cartao = porta("Entrega e frete") as HTMLElement;
    await act(async () => {
      cartao.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(idas).toEqual(["admin-shipping"]);
  });

  it("nenhum cartão leva para admin-push; banners, vitrines, Minha loja e Frete continuam alcançáveis", async () => {
    for (const cartao of container.querySelectorAll('[role="button"]')) {
      await act(async () => {
        cartao.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }
    expect(idas).not.toContain("admin-push");
    expect(idas).toContain("admin-banners");
    expect(idas).toContain("admin-carousels");
    expect(idas).toContain("admin-about-store");
    expect(idas).toContain("admin-shipping");
  });

  it("o acordeão das transportadoras se chama 'Transportadoras', não 'Entrega e frete'", () => {
    const cabecalhos = [...container.querySelectorAll("button[aria-expanded]")];
    const nomes = cabecalhos.map((b) => b.textContent ?? "");
    expect(nomes.some((n) => n.includes("Transportadoras"))).toBe(true);
    expect(nomes.some((n) => n.includes("Entrega e frete"))).toBe(false);
  });

  it("o título da tela vem de NOMES_DO_PAINEL", () => {
    const titulo = container.querySelector("h1");
    expect(titulo?.textContent).toContain(NOMES_DO_PAINEL["admin-settings"]);
    const caminho = join(
      __dirname,
      "..",
      "..",
      "src/views/admin/AdminSettingsView.tsx",
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho do próprio repositório, não entrada de usuário
    const fonte = readFileSync(caminho, "utf8");
    expect(fonte).toContain('titulo={NOMES_DO_PAINEL["admin-settings"]}');
  });

  it("a ajuda lista os mesmos grupos que a tela e não diz mais 'três grupos'", async () => {
    const abrir = container.querySelector<HTMLButtonElement>(
      'button[title="Guia de Configurações e Ajuda"]',
    );
    expect(abrir, "botão de ajuda ausente").not.toBeNull();
    await act(async () => {
      abrir!.click();
    });
    const folha = document.body.querySelector('[role="dialog"]');
    expect(folha, "ajuda não abriu").not.toBeNull();

    const titulosDaAjuda = [...folha!.querySelectorAll("h4")]
      .map((h) => h.textContent ?? "")
      .filter((t) => t !== "Como está sua loja");
    expect(titulosDaAjuda).toEqual(titulosDosGrupos());

    const texto = folha!.textContent ?? "";
    expect(texto).not.toMatch(/três grupos/i);
    expect(texto).not.toContain("Pós-venda");
  });
});
