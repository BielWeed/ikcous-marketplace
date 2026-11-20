// @vitest-environment jsdom
import { ContatoDaLoja } from "@/components/admin/minha-loja/ContatoDaLoja";
import { montarMensagemDeCompartilhar } from "@/lib/mensagem-de-compartilhar";
import type { EditorDeMinhaLoja } from "@/views/admin/AdminAboutStoreView";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { config, updateConfig } = vi.hoisted(() => ({
  config: { shareText: "Frase antiga" },
  updateConfig: vi.fn(async () => true),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config,
    isLoaded: true,
    products: [],
    updateConfig,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

it("grava a frase sem o espaço não separável colado no fim", async () => {
  const caixa = document.createElement("div");
  const raiz = createRoot(caixa);
  let salvar: EditorDeMinhaLoja["salvar"] | undefined;
  const mostrarContato = () =>
    raiz.render(
      <ContatoDaLoja
        onRegistrarSalvamento={(editor) => {
          salvar = editor.salvar;
        }}
      />,
    );
  try {
    act(mostrarContato);
    const campo = caixa.querySelector(
      "#settings-share-message-editor",
    ) as HTMLElement;
    act(() => {
      campo.textContent = "Confira!\u{00a0}";
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      expect(await salvar?.()).toBe(true);
    });
    expect(updateConfig).toHaveBeenCalledWith(
      { shareText: "Confira!" },
      { silentSuccess: true },
    );
    config.shareText = "Confira!";
    act(mostrarContato);
    expect(campo.textContent).toBe("Confira!");
  } finally {
    act(() => raiz.unmount());
  }
});

it("usa um só espaço entre a frase antiga e o nome do produto", () => {
  const mensagem = montarMensagemDeCompartilhar("Confira!\u{00a0}", {
    nome: "Camiseta",
    preco: "R$ 49,90",
    link: "https://loja.exemplo/produto",
  });
  expect(mensagem.texto).toBe("Confira! Camiseta por R$ 49,90");
});
