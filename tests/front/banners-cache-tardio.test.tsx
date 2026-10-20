import type { Banner } from "@/types";
// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const rede = vi.hoisted(() => ({
  lerCache: vi.fn(),
  consultar: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: () => {} }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getAll: rede.lerCache,
      replaceAll: async () => {},
      setLastSync: () => {},
    }),
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => ({ order: rede.consultar }) }),
  },
}));

import { useBanners } from "@/hooks/useBanners";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let host: HTMLDivElement;
let lista: Banner[] = [];
function Sonda() {
  const { banners } = useBanners();
  useEffect(() => {
    lista = banners;
  });
  return null;
}
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

it("rede vazia vence o cache antigo, inclusive na próxima montagem", async () => {
  let devolverCache!: (banners: Banner[]) => void;
  let devolverRede!: (resposta: { data: unknown[]; error: null }) => void;
  rede.lerCache.mockReturnValue(
    new Promise<Banner[]>((resolve) => {
      devolverCache = resolve;
    }),
  );
  rede.consultar.mockReturnValue(
    new Promise((resolve) => {
      devolverRede = resolve;
    }),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
  await act(async () => {
    raiz.render(<Sonda />);
  });
  // As duas leituras já começaram; a rede confirma a exclusão primeiro.
  expect(rede.lerCache).toHaveBeenCalled();
  await act(async () => {
    devolverRede({ data: [], error: null });
  });
  expect(lista).toEqual([]);
  await act(async () => {
    devolverCache([
      {
        id: "removido",
        imageUrl: "/banner.png",
        title: "Antigo",
        position: "home_top",
        active: true,
        order: 1,
      },
    ]);
  });
  expect(lista).toEqual([]);
  await act(async () => {
    raiz.render(<Sonda key="nova-montagem" />);
  });
  expect(lista).toEqual([]);
});
