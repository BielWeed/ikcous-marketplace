import { useBanners } from "@/hooks/useBanners";
import type { Banner } from "@/types";
// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({
  linhas: [] as {
    id: string;
    order: number;
    position: string;
    title: string;
    image_url: string;
    active: boolean;
  }[],
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: (_colunas: string) => ({
        order: () =>
          Promise.resolve({
            data: banco.linhas.map((b) => ({ ...b })),
            error: null,
          }),
        eq: (_campo: string, pos: string) => ({
          order: () => ({
            order: () =>
              Promise.resolve({
                data: banco.linhas
                  .filter((b) => b.position === pos)
                  .map((b) => ({ id: b.id, order: b.order }))
                  .sort(
                    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
                  ),
                error: null,
              }),
          }),
        }),
      }),
      update: (dados: Partial<Banner>) => ({
        eq: (_campo: string, id: string) => {
          Object.assign(banco.linhas.find((b) => b.id === id)!, dados);
          return Object.assign(Promise.resolve({ error: null }), {
            select: () => Promise.resolve({ data: [{ id }], error: null }),
          });
        },
      }),
      insert: (linhas: typeof banco.linhas) => ({
        select: () => ({
          single: () => {
            const linha = { ...linhas[0], id: "z-novo" };
            banco.linhas.push(linha);
            return Promise.resolve({ data: linha, error: null });
          },
        }),
      }),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: () => {} }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getAll: vi.fn().mockResolvedValue([]),
      replaceAll: vi.fn().mockResolvedValue(undefined),
      setLastSync: vi.fn(),
    }),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let atual: ReturnType<typeof useBanners>;
const host = document.createElement("div");
let raiz: ReturnType<typeof createRoot>;
function Sonda() {
  const resultado = useBanners(true);
  useEffect(() => {
    atual = resultado;
  });
  return (
    <p>
      {resultado.banners
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((b) => b.id)
        .join(",")}
    </p>
  );
}
beforeEach(async () => {
  banco.linhas = ["a-primeiro", "b-segundo", "z-terceiro"].map((id, i) => ({
    id,
    order: i + 1,
    position: "home_top",
    title: id,
    image_url: "https://loja.test/banner.jpg",
    active: true,
  }));
  document.body.appendChild(host);
  raiz = createRoot(host);
  await act(async () => raiz.render(<Sonda />));
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.clearAllMocks();
});

it("editar para ordem 1 põe o salvo antes do empate, no aparelho e no banco", async () => {
  await act(async () => atual.updateBanner("z-terceiro", { order: 1 }));
  expect(host.textContent).toBe("z-terceiro,a-primeiro,b-segundo");
  expect(banco.linhas.map((b) => [b.id, b.order])).toEqual([
    ["a-primeiro", 2],
    ["b-segundo", 3],
    ["z-terceiro", 1],
  ]);
});
it.each([
  {
    quantidade: 2,
    destino: 2,
    esperado: "b-segundo,a-primeiro",
    ordens: [2, 1],
  },
  {
    quantidade: 4,
    destino: 3,
    esperado: "b-segundo,c-terceiro,a-primeiro,d-quarto",
    ordens: [3, 1, 2, 4],
  },
])(
  "descer de 1 para $destino em $quantidade banners respeita a posição no aparelho e no banco",
  async ({ quantidade, destino, esperado, ordens }) => {
    banco.linhas = ["a-primeiro", "b-segundo", "c-terceiro", "d-quarto"]
      .slice(0, quantidade)
      .map((id, i) => ({
        id,
        order: i + 1,
        position: "home_top",
        title: id,
        image_url: "https://loja.test/banner.jpg",
        active: true,
      }));
    await act(async () => atual.refreshBanners(true));
    await act(async () => atual.updateBanner("a-primeiro", { order: destino }));
    expect(host.textContent).toBe(esperado);
    expect(banco.linhas.map((b) => b.order)).toEqual(ordens);
  },
);

it("criar com ordem 1 põe o novo antes dos existentes", async () => {
  await act(async () => {
    await atual.addBanner({
      title: "Novo",
      imageUrl: "https://loja.test/novo.jpg",
      position: "home_top",
      active: true,
      order: 1,
    });
  });
  expect(host.textContent).toBe("z-novo,a-primeiro,b-segundo,z-terceiro");
  expect(banco.linhas.map((b) => [b.id, b.order])).toEqual([
    ["a-primeiro", 2],
    ["b-segundo", 3],
    ["z-terceiro", 4],
    ["z-novo", 1],
  ]);
});
