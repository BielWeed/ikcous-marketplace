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

it("P33 recorta o fundo sem criar outro contêiner de rolagem no PC", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<AuthView onNavigate={vi.fn()} />));
    const pagina = host.firstElementChild as HTMLElement;
    // Literal anterior à P33. Não consulta histórico: CI clona só o topo.
    expect(classesDoCelular(pagina.className)).toBe(
      "pb-customer relative flex min-h-full w-full flex-shrink-0 flex-col items-center overflow-x-hidden bg-white p-6 sm:pb-8",
    );
    expect(pagina.classList.contains("lg:overflow-clip")).toBe(true);
    expect(host.querySelector("form")).not.toBeNull();
    expect(host.querySelector("#password")).not.toBeNull();
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
