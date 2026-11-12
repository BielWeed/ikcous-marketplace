// @vitest-environment jsdom
//
// Balcão — o cartão "Leitura repetida" aparece POR CIMA da câmera e das abas
// quando a mesma peça é lida de novo pela câmera logo depois da primeira. Ele
// não tinha botão de fechar: só sumia quando outra peça entrava ou saía, e a
// lojista ficava com o cartão na frente do leitor. Agora tem "Fechar", como
// os outros avisos do cupom (código não encontrado, produto inativo, esgotado).
//
// View e hook reais; só o banco, o contexto e a câmera são dublados. O dublê da
// câmera entrega a leitura SEM `deTeclado` (é assim que a câmera lê).
import { AdminPdvView } from "@/views/admin/AdminPdvView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "operador" } }),
}));
vi.mock("@/components/admin/pdv/LeitorDeCodigo", () => ({
  LeitorDeCodigo: ({
    aoLer,
  }: {
    aoLer: (leitura: { codigo: string; formato: string }) => void;
  }) => (
    <button
      type="button"
      data-testid="camera-leu"
      onClick={() => aoLer({ codigo: "78912345", formato: "ean_13" })}
    >
      câmera leu
    </button>
  ),
}));
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const respostaDoBipe = {
  encontrado: true,
  origem: "produto",
  codigo: "78912345",
  produto: {
    id: "bipado",
    nome: "Produto bipado",
    ativo: true,
    preco_venda: 35,
    estoque: 7,
    imagem: null,
    codigo_barras: "78912345",
    tem_variantes: false,
  },
  variante: null,
  preco: 35,
  estoque: 7,
  variacoes: [],
};

let host: HTMLDivElement;
let raiz: Root;
beforeEach(() => {
  const dados = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => dados.set(chave, valor),
    removeItem: (chave: string) => dados.delete(chave),
  });
  vi.useFakeTimers();
  rpc.mockReset();
  rpc.mockImplementation(async (nome: string) => {
    if (nome === "buscar_por_codigo_barras")
      return { data: respostaDoBipe, error: null };
    throw new Error(`RPC inesperada: ${nome}`);
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "");
});

async function cameraLeu() {
  await act(async () => {
    (
      host.querySelector('[data-testid="camera-leu"]') as HTMLButtonElement
    ).click();
    await vi.advanceTimersByTimeAsync(0);
  });
}

const quantidades = () =>
  [...host.querySelectorAll('[aria-label="Itens da venda"] li')].map(
    (li) => li.querySelector(".pdv-quantity span")?.textContent,
  );

it("a leitura repetida da câmera não soma e o cartão de aviso pode ser fechado", async () => {
  await act(async () =>
    raiz.render(<AdminPdvView active onNavigate={vi.fn()} />),
  );
  await cameraLeu();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  await cameraLeu();

  // A segunda leitura da câmera, tão perto da primeira, NÃO virou 2 unidades…
  expect(quantidades()).toEqual(["1"]);
  // …e o aviso aparece com um jeito de fechar.
  const cartao = host.querySelector('[role="status"].pdv-notice');
  expect(cartao?.textContent).toContain("Leitura repetida");
  const fechar = [...(cartao?.querySelectorAll("button") ?? [])].find(
    (b) => b.textContent?.trim() === "Fechar",
  );
  expect(fechar).toBeTruthy();

  await act(async () => {
    fechar?.click();
  });

  expect(host.textContent).not.toContain("Leitura repetida");
  // Fechar o aviso não mexe na venda.
  expect(quantidades()).toEqual(["1"]);
});
