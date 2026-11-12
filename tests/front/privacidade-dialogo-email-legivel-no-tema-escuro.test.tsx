// @vitest-environment jsdom
//
// "CORRIGIR O E-MAIL" EM LOJA COM TEMA ESCURO. O defeito: o rótulo do campo
// usava `text-zinc-900` e a dica `text-zinc-600`, cores FIXAS, dentro de um
// diálogo que pinta o fundo com `bg-background`. Na loja escura o fundo vira
// quase preto e o rótulo (zinc-900) some; a dica fica com pouco contraste.
// Agora os dois usam os tokens do tema (`text-foreground` e
// `text-muted-foreground`), que viram claros no escuro e escuros no claro.
//
// O jsdom não calcula CSS: o teste lê as classes. Molde de montagem:
// privacidade-voltar-fecha-so-o-dialogo.test.tsx.
import { PrivacidadeEMeusDados } from "@/components/account/PrivacidadeEMeusDados";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const USER_ID = "cliente-1";
const EMAIL_ATUAL = "maria@exemplo.com";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

function esperar(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const dialogo = () =>
  document.body.querySelector<HTMLElement>('[role="alertdialog"]');
const botao = (texto: string, dentro: ParentNode = document.body) =>
  [...dentro.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    (b.textContent ?? "").includes(texto),
  );

describe("PrivacidadeEMeusDados — o diálogo de e-mail é legível no tema escuro", () => {
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

  async function abrirDialogoDeEmail() {
    await act(async () => {
      raiz.render(
        <PrivacidadeEMeusDados userId={USER_ID} emailAtual={EMAIL_ATUAL} />,
      );
      await esperar();
    });
    await act(async () => {
      botao("Corrigir meu e-mail")?.click();
      await esperar(120);
    });
    expect(dialogo()).not.toBeNull();
  }

  it("o rótulo do campo usa a cor de texto do tema, não um zinc fixo", async () => {
    await abrirDialogoDeEmail();
    const rotulo = dialogo()?.querySelector<HTMLLabelElement>(
      'label[for="privacidade-email-novo"]',
    );
    expect(rotulo).toBeTruthy();
    const classes = (rotulo?.className ?? "").split(/\s+/);
    expect(classes).toContain("text-foreground");
    expect(classes.some((c) => c.startsWith("text-zinc-"))).toBe(false);
  });

  it("a dica sob o campo usa o cinza do tema, não um zinc fixo", async () => {
    await abrirDialogoDeEmail();
    const dica = dialogo()?.querySelector<HTMLElement>(
      "#privacidade-email-dica",
    );
    expect(dica).toBeTruthy();
    const classes = (dica?.className ?? "").split(/\s+/);
    expect(classes).toContain("text-muted-foreground");
    expect(classes.some((c) => c.startsWith("text-zinc-"))).toBe(false);
  });
});
