// @vitest-environment jsdom
import type { Category } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  consultar: vi.fn(),
  ler: vi.fn(),
  salvar: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ select: () => ({ order: h.consultar }) }) },
}));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getAll: h.ler,
      replaceAll: h.salvar,
      setLastSync: async () => {},
    }),
  },
}));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: () => {} }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function controlada<T>() {
  let responder!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    responder = resolve;
  });
  return { promessa, responder };
}

const antiga: Category = {
  id: "c1",
  name: "Calçados",
  slug: "calcados",
  description: "",
  isActive: true,
  createdAt: "2026-01-01T00:00:00Z",
};
function resposta(vazia: boolean) {
  return {
    data: vazia
      ? []
      : [
          {
            id: "c1",
            nome: "Sapatos",
            slug: "sapatos",
            descricao: "",
            ativo: true,
            created_at: antiga.createdAt,
          },
        ],
    error: null,
  };
}

describe("useCategories — disco atrasado não vence a rede", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let emMemoria!: () => Category[] | null;
  let montar!: () => Promise<void>;

  beforeEach(async () => {
    vi.resetModules();
    h.consultar.mockReset();
    h.ler.mockReset();
    h.salvar.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { useCategories, categoriasEmMemoria } = await import(
      "@/hooks/useCategories"
    );
    emMemoria = categoriasEmMemoria;
    function Sonda() {
      const { categories, isLoading } = useCategories();
      return (
        <p>
          {isLoading ? "Carregando" : categories.map((c) => c.name).join(",")}
        </p>
      );
    }
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    montar = async () => {
      await act(async () => raiz.render(<Sonda />));
      expect(h.ler).toHaveBeenCalledWith("categories");
    };
  });

  afterEach(async () => {
    await act(async () => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it.each([false, true])(
    "preserva a rede confirmada, inclusive vazia=%s",
    async (vazia) => {
      const disco = controlada<Category[]>();
      const rede = controlada<ReturnType<typeof resposta>>();
      h.ler.mockReturnValue(disco.promessa);
      h.consultar.mockReturnValue(rede.promessa);
      await montar();
      await act(async () => rede.responder(resposta(vazia)));
      const nomes = vazia ? [] : ["Sapatos"];
      expect(hospedeiro.textContent).toBe(nomes.join(","));
      expect(emMemoria()?.map((c) => c.name)).toEqual(nomes);
      await act(async () => disco.responder([antiga]));
      expect(hospedeiro.textContent).toBe(nomes.join(","));
      expect(emMemoria()?.map((c) => c.name)).toEqual(nomes);
      expect(h.salvar).toHaveBeenCalledTimes(1);
    },
  );

  it("sem resposta da rede, ainda restaura a cópia do aparelho", async () => {
    const disco = controlada<Category[]>();
    h.ler.mockReturnValue(disco.promessa);
    h.consultar.mockResolvedValue({ data: null, error: new Error("Sem rede") });
    await montar();
    await act(async () => disco.responder([antiga]));
    expect(hospedeiro.textContent).toBe("Calçados");
    expect(emMemoria()).toEqual([antiga]);
    expect(h.salvar).not.toHaveBeenCalled();
  });
});
