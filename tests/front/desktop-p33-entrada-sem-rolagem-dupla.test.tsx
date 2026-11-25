// @vitest-environment jsdom
import { AuthView } from "@/views/shared/AuthView";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isPasswordRecovery: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/lib/google-login", () => ({
  googleLigadoNestaLoja: async () => false,
  navegadorInternoDaMeta: () => false,
  mensagemComDicaGoogle: (mensagem: string) => mensagem,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("P33 recorta o fundo sem criar outro contêiner de rolagem, no PC e no celular", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<AuthView onNavigate={vi.fn()} />));
    const pagina = host.firstElementChild as HTMLElement;
    // Com `overflow-x-hidden` o navegador também trata o eixo vertical como
    // rolável: os brilhos decorativos que passam da borda viravam ~150 px de
    // rolagem a mais na tela de entrada do celular (relato do dono, 25/11).
    // `overflow-clip` recorta sem criar contêiner de rolagem; `overflow-hidden`
    // fica só como reserva para navegador sem suporte a `clip`.
    expect(classesDoCelular(pagina.className)).toBe(
      "pb-customer relative flex min-h-full w-full flex-shrink-0 flex-col items-center overflow-hidden overflow-clip bg-white p-6 sm:pb-8",
    );
    expect(pagina.classList.contains("overflow-x-hidden")).toBe(false);
    expect(host.querySelector("form")).not.toBeNull();
    expect(host.querySelector("#password")).not.toBeNull();
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
