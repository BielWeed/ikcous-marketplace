// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { FolhaInferior } from "@/components/admin/vitrines/FolhaInferior";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("mantém o círculo de 32 px e amplia o toque para 44 px", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const fechar = vi.fn();
  try {
    await act(async () =>
      root.render(
        <FolhaInferior
          titulo="Vitrine"
          descricao="Editar vitrine"
          aoFechar={fechar}
          rodape={null}
        >
          Conteúdo
        </FolhaInferior>,
      ),
    );
    const botao = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Fechar"]',
    );
    expect(botao).not.toBeNull();
    expect(botao?.className).toContain("size-8");
    expect(botao?.className).toContain("relative");
    // 32 px do círculo + 6 px de cada lado = 44 px, sem deslocar o cabeçalho.
    expect(botao?.className).toContain("after:absolute");
    expect(botao?.className).toContain("after:-inset-1.5");
    await act(async () => botao?.click());
    expect(fechar).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
