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

const cozinheira = "👩🏽\u{200d}🍳";
const apertoDeMao = "🧑🏻\u{200d}🤝\u{200d}🧑🏿";
const bandeira =
  "\u{1f3f4}\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}";
const tecla = "#\u{fe0f}\u{20e3}";

it.each([
  ["Confira!\u{00a0}", "Confira!"],
  [cozinheira, cozinheira],
  [apertoDeMao, apertoDeMao],
  [bandeira, bandeira],
  [tecla, tecla],
  ["Oi, 🧑\u{200d}🍳!<br>Confira", "Oi, 🧑\u{200d}🍳!\nConfira"],
  ["Confira!<br>", "Confira!\n"],
  ["Família 👨\u{200d}👩\u{200d}👧", "Família 👨\u{200d}👩\u{200d}👧"],
  ["🏳\u{fe0f}\u{200d}🌈 oi", "🏳\u{fe0f}\u{200d}🌈 oi"],
  ["a\u{200d}b", "ab"],
])("normaliza apenas o necessário ao gravar %s", async (digitado, esperado) => {
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
      campo.innerHTML = digitado;
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      expect(await salvar?.()).toBe(true);
    });
    expect(updateConfig).toHaveBeenLastCalledWith(
      { shareText: esperado },
      { silentSuccess: true },
    );
    config.shareText = esperado;
    act(mostrarContato);
    expect(campo.innerHTML).toBe(esperado.replaceAll("\n", "<br>"));
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

it("mantém o emoji, as quebras e o espaçamento interno da frase antiga", () => {
  const mensagem = montarMensagemDeCompartilhar(
    "Oi,  🧑\u{200d}🍳!\nConfira!\n",
    {
      nome: "Camiseta",
      preco: "R$ 49,90",
      link: "https://loja.exemplo/produto",
    },
  );
  expect(mensagem.texto).toBe(
    "Oi,  🧑\u{200d}🍳!\nConfira!\n Camiseta por R$ 49,90",
  );
});
