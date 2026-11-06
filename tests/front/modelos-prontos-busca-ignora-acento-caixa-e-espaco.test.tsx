// @vitest-environment jsdom
//
// Minha loja › Contato › Modelos prontos: a busca só fazia `toLowerCase()` e
// `includes`. "classico" (sem acento) não achava "Clássico", e "elegante " (com o
// espaço que o teclado do celular põe ao aceitar a sugestão) não achava nada.
// O resto do painel usa `normalizeText`; a busca dos modelos agora também.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ products: [], config: {} }),
}));

import { MensagemDeCompartilhar } from "@/components/admin/minha-loja/MensagemDeCompartilhar";

describe("Modelos prontos: a busca ignora acento, caixa e espaço no fim", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    window.history.replaceState({ view: "admin-about-store" }, "", "/");
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function abrirFolha() {
    await act(async () => {
      raiz.render(
        <MensagemDeCompartilhar
          texto="Olha que achei!"
          carga={{ texto: "Olha que achei!", id: 1 }}
          onMudar={() => {}}
        />,
      );
    });
    const abrir = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Modelos prontos ("),
    );
    expect(abrir).toBeDefined();
    await act(async () => {
      abrir?.click();
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  async function digitar(valor: string) {
    const campo = document.body.querySelector<HTMLInputElement>(
      "#preset-search-input",
    );
    expect(campo).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(campo, valor);
      campo?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  const nomesVisiveis = () =>
    [...document.body.querySelectorAll("button span.uppercase")].map((s) =>
      s.textContent?.trim(),
    );

  it("'classico' sem acento acha o modelo 'Clássico'", async () => {
    await abrirFolha();
    await digitar("classico");
    expect(nomesVisiveis()).toContain("Clássico");
    expect(document.body.textContent).not.toContain("Nenhum modelo encontrado");
  });

  it("'ULTIMAS' em caixa alta e sem acento acha 'Últimas Unidades'", async () => {
    await abrirFolha();
    await digitar("ULTIMAS");
    expect(nomesVisiveis()).toContain("Últimas Unidades");
  });

  it("'elegante ' com espaço no fim acha 'Elegante'", async () => {
    await abrirFolha();
    await digitar("elegante ");
    expect(nomesVisiveis()).toContain("Elegante");
  });

  it("'classico ' com acento faltando E espaço no fim acha 'Clássico'", async () => {
    await abrirFolha();
    await digitar("classico ");
    expect(nomesVisiveis()).toContain("Clássico");
  });

  it("controle: termo vazio lista todos e termo sem resultado mostra o aviso", async () => {
    await abrirFolha();
    await digitar("   ");
    expect(nomesVisiveis().length).toBeGreaterThan(20);
    await digitar("zzzxxqq");
    expect(document.body.textContent).toContain("Nenhum modelo encontrado");
  });
});
