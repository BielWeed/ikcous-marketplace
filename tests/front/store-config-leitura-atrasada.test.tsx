import { StoreProvider, useStore } from "@/contexts/StoreContext";
// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Resposta = { data: unknown; error: unknown };
const rede = vi.hoisted(() => ({
  leitura: Promise.resolve<Resposta>({ data: null, error: null }),
  escrita: { data: null, error: null } as Resposta,
  put: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, loading: false, user: { id: "admin-1" } }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getById: vi.fn().mockResolvedValue(null),
      getAll: vi.fn().mockResolvedValue([]),
      put: rede.put,
      replaceAll: vi.fn().mockResolvedValue(undefined),
      setLastSync: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));
vi.mock("@/lib/realtimeSyncEngine", () => ({
  RealtimeSyncEngine: {
    start: vi.fn(() => () => {}),
    onSync: vi.fn(() => () => {}),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));

function consulta(resultado: Promise<Resposta>) {
  return new Proxy(() => {}, {
    get(_alvo, prop) {
      if (prop === "then") return resultado.then.bind(resultado);
      return () => consulta(resultado);
    },
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) =>
      consulta(
        tabela === "store_config"
          ? rede.leitura
          : Promise.resolve({ data: [], error: null }),
      ),
    rpc: () => consulta(Promise.resolve(rede.escrita)),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pendente() {
  let resolver!: (resposta: Resposta) => void;
  const promessa = new Promise<Resposta>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

const HORARIO_ANTIGO = {
  data: { business_hours: "Segunda: 09h às 18h" },
  error: null,
};
const HORARIO_NOVO = {
  data: { business_hours: "Segunda: 10h às 19h" },
  error: null,
};

describe("StoreContext — leitura anterior ao salvar não volta para a tela nem para o cache", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let contexto: ReturnType<typeof useStore> | undefined;

  function Espiao() {
    const loja = useStore();
    useEffect(() => {
      contexto = loja;
    });
    return <output>{loja.config.businessHours}</output>;
  }

  function loja() {
    if (!contexto) throw new Error("Contexto ainda não montou");
    return contexto;
  }

  async function montar() {
    await act(async () => {
      raiz.render(
        <StoreProvider>
          <Espiao />
        </StoreProvider>,
      );
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    rede.leitura = Promise.resolve(HORARIO_ANTIGO);
    rede.escrita = HORARIO_NOVO;
    contexto = undefined;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it.each([true, false])(
    "descarta a leitura antiga após escrita confirmada (primeira carga: %s)",
    async (primeiraCarga) => {
      const lenta = pendente();
      let refresh: Promise<void> | undefined;
      if (primeiraCarga) rede.leitura = lenta.promessa;
      await montar();
      if (!primeiraCarga) {
        rede.leitura = lenta.promessa;
        await act(async () => {
          refresh = loja().refresh({ onlyConfig: true });
        });
      }

      await act(async () => {
        const salvou = await loja().updateConfig({
          businessHours: "Segunda: 10h às 19h",
        });
        expect(salvou).toBe(true);
      });
      expect(hospedeiro.textContent).toBe("Segunda: 10h às 19h");
      const escritasAntes = rede.put.mock.calls.length;

      await act(async () => {
        lenta.resolver(HORARIO_ANTIGO);
        await refresh;
      });

      expect(hospedeiro.textContent).toBe("Segunda: 10h às 19h");
      expect(loja().isLoaded).toBe(true);
      expect(rede.put).toHaveBeenLastCalledWith(
        "store_config",
        expect.objectContaining({ businessHours: "Segunda: 10h às 19h" }),
      );
      expect(rede.put.mock.calls.length).toBe(escritasAntes);
    },
  );

  it("aceita uma leitura iniciada depois do salvamento", async () => {
    await montar();
    await act(async () => {
      await loja().updateConfig({ businessHours: "Segunda: 10h às 19h" });
    });
    rede.leitura = Promise.resolve({
      data: { business_hours: "Terça: 08h às 17h" },
      error: null,
    });
    await act(async () => {
      await loja().refresh({ onlyConfig: true });
    });

    expect(hospedeiro.textContent).toBe("Terça: 08h às 17h");
    expect(rede.put).toHaveBeenLastCalledWith(
      "store_config",
      expect.objectContaining({ businessHours: "Terça: 08h às 17h" }),
    );
  });

  it("salvamento sem confirmação não invalida a leitura em andamento", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const lenta = pendente();
    rede.leitura = lenta.promessa;
    rede.escrita = { data: null, error: null };
    await montar();
    await act(async () => {
      const salvou = await loja().updateConfig({
        businessHours: "Segunda: 10h às 19h",
      });
      expect(salvou).toBe(false);
    });
    await act(async () => lenta.resolver(HORARIO_ANTIGO));

    expect(hospedeiro.textContent).toBe("Segunda: 09h às 18h");
    expect(loja().isLoaded).toBe(true);
    expect(rede.put).toHaveBeenLastCalledWith(
      "store_config",
      expect.objectContaining({ businessHours: "Segunda: 09h às 18h" }),
    );
  });
});
