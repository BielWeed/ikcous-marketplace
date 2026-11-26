// @vitest-environment jsdom
//
// Trava (plano das miniaturas, 26/11/2026): o BACKUP de uma foto marcada
// continua SEM marca.
//
// Apagar uma variação (ou um produto) COPIA a foto para `backup/` com um
// carimbo de hora no nome (`backupStorageFile`). As 3 cópias reduzidas não vão
// para o backup -- então o endereço do backup NUNCA pode ser lido como marcado,
// senão a tela pediria cópias que não existem. Duas barreiras garantem isso: a
// pasta `backup/` e o carimbo depois da marca (`<uuid>-vw_<hora>.jpg`). Este
// teste prende as duas no caminho REAL do hook.
import { useProducts } from "@/hooks/useProducts";
import { imagemRedimensionada } from "@/lib/imageUrl";
import { marcaDe, marcaDoNome } from "@/lib/piramide-da-foto-nomes";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PASTA =
  "https://novalojagratisaaaaaa.supabase.co/storage/v1/object/public/products/";
const U = "3f2b8c1e-9a4d-4e7b-8c21-5d6f7a8b9c0d";

const h = vi.hoisted(() => ({
  copy: vi.fn(),
  remove: vi.fn(),
  imagemDaVariacao: "",
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "u-1" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    products: [],
    loadingProducts: false,
    fetchProducts: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { refreshSession: vi.fn() },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { image_url: h.imagemDaVariacao },
            error: null,
          }),
        }),
      }),
      delete: () => ({
        eq: (_c: string, id: string) => ({
          select: async () => ({ data: [{ id }], error: null }),
        }),
      }),
    }),
    storage: {
      from: () => ({
        copy: h.copy,
        remove: h.remove,
        getPublicUrl: (caminho: string) => ({
          data: { publicUrl: `${PASTA}${caminho}` },
        }),
      }),
    },
  },
}));

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("backup ao apagar: foto marcada vira backup SEM marca", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let api: ReturnType<typeof useProducts>;

  beforeEach(async () => {
    h.copy.mockReset().mockResolvedValue({ data: {}, error: null });
    h.remove.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    function Sonda() {
      const hook = useProducts({ autoFetch: false });
      useEffect(() => {
        api = hook;
      });
      return null;
    }
    await act(async () => raiz.render(<Sonda />));
  });

  afterEach(async () => {
    await act(async () => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it.each([
    ["w", `${U}-vw.jpg`],
    ["j", `${U}-vj.png`],
  ])(
    "marca %s: uma cópia só (a original), para backup/ e sem marca",
    async (_m, nome) => {
      h.imagemDaVariacao = `${PASTA}${nome}`;
      await act(async () => {
        await api.deleteVariant("var-1");
      });

      expect(h.copy).toHaveBeenCalledTimes(1);
      const [de, para] = h.copy.mock.calls[0] as [string, string];
      expect(de).toBe(nome);
      const [base, ext] = nome.split(".");
      expect(para).toMatch(new RegExp(`^backup/${base}_\\d+\\.${ext}$`));
      // As duas barreiras: a pasta e o carimbo depois da marca.
      expect(marcaDoNome(para.slice("backup/".length))).toBeNull();
      const urlDoBackup = `${PASTA}${para}`;
      expect(marcaDe(urlDoBackup)).toBeNull();
      // A vitrine serve o próprio backup, nunca uma cópia inexistente.
      expect(imagemRedimensionada(urlDoBackup, { width: 340 })).toBe(
        urlDoBackup,
      );
      // A original e as cópias dela ficam onde estão (backup copia, não move).
      expect(h.remove).not.toHaveBeenCalled();
    },
  );
});
