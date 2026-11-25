// @vitest-environment jsdom
//
// Buracos de prova achados por MUTAÇÃO em `PoliticaDaLojaView.tsx`: os testes
// vizinhos (`politicas-pagina`, `politicas-identidade-legal`) trocam
// `useDocumentMeta` por um dublê vazio e não medem a vibração. Dois defeitos
// de uma linha sobreviviam:
// - inverter o título da aba ("Loja | Política" no lugar de "Política | Loja"):
//   é o texto que a cliente vê na aba do navegador e no histórico;
// - tirar `haptic.light()` do toque nos links "outras páginas da loja".
// Aqui o `useDocumentMeta` é o de verdade (escreve em `document.title`) e só o
// conteúdo jurídico (que consulta o banco) é trocado por um dublê.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { TipoDePolitica } from "@/lib/nomes-das-politicas";

const estado = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  vibrou: vi.fn(),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config }),
}));
vi.mock("@/components/politicas/ConteudoDaPolitica", () => ({
  ConteudoDaPolitica: ({ tipo }: { tipo: string }) => (
    <div data-testid="conteudo">{tipo}</div>
  ),
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: estado.vibrou, medium: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("PoliticaDaLojaView — título da aba e vibração dos links", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn();

  beforeAll(async () => {
    await import("@/views/customer/PoliticaDaLojaView");
  }, 60_000);

  beforeEach(() => {
    estado.config = { storeName: "Loja da Ana" };
    estado.vibrou.mockClear();
    onNavigate.mockClear();
    document.title = "Título de antes";
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

  async function abrir(tipo: TipoDePolitica) {
    const { PoliticaDaLojaView } = await import(
      "@/views/customer/PoliticaDaLojaView"
    );
    await act(async () => {
      raiz.render(<PoliticaDaLojaView tipo={tipo} onNavigate={onNavigate} />);
    });
  }

  it.each([
    ["termos", "Termos de uso | Loja da Ana"],
    ["privacidade", "Política de Privacidade | Loja da Ana"],
    ["trocas", "Trocas e devoluções | Loja da Ana"],
  ] as const)(
    "a aba do navegador diz 'política | loja' (%s)",
    async (tipo, titulo) => {
      await abrir(tipo);
      expect(document.title).toBe(titulo);
    },
  );

  it("ao sair da página o título de antes volta", async () => {
    await abrir("termos");
    expect(document.title).toBe("Termos de uso | Loja da Ana");
    act(() => {
      raiz.render(<div />);
    });
    expect(document.title).toBe("Título de antes");
  });

  it("tocar em outra página da loja vibra uma vez e navega para a tela certa", async () => {
    await abrir("termos");
    const links = [
      ...hospedeiro.querySelectorAll<HTMLButtonElement>(
        "nav[aria-label='Outras páginas da loja'] button",
      ),
    ];
    expect(links.map((b) => b.textContent)).toEqual([
      "Política de Privacidade",
      "Trocas e devoluções",
    ]);
    await act(async () => {
      links[1].click();
    });
    expect(estado.vibrou).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("returns-policy");
  });
});
