import { StoreProvider, useStore } from "@/contexts/StoreContext";
import { AdminSettingsView } from "@/views/admin/AdminSettingsView";
// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: {
    isAdmin: true,
    adminStatus: "admin",
    loading: false,
    user: { id: "a" },
    session: { user: { id: "a" } },
  },
  rpc: vi.fn(),
  init: vi.fn(),
  put: vi.fn(),
  dirty: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/dataVault", () => ({ DataVault: { init: h.init } }));
vi.mock("@/lib/realtimeSyncEngine", () => ({
  RealtimeSyncEngine: {
    start: vi.fn(() => () => {}),
    onSync: vi.fn(() => () => {}),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/env-valores", () => ({
  lerSupabaseUrl: () => "https://abcdefghijklmnopqrst.supabase.co",
  lerChaveSupabase: () => "sb_publishable_synthetic",
}));
function query(result: { data: unknown; error: null }): unknown {
  return new Proxy(() => {}, {
    get(_target, key) {
      if (key === "then")
        return (resolve: (value: unknown) => void) => resolve(result);
      return () => query(result);
    },
  });
}
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) =>
      query({
        data:
          table === "store_config" || table === "v_store_config" ? null : [],
        error: null,
      }),
    rpc: h.rpc,
  },
}));
// @ts-expect-error React testing flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
type Store = ReturnType<typeof useStore>;
let store: Store;
function Observe() {
  const currentStore = useStore();
  useEffect(() => {
    store = currentStore;
  }, [currentStore]);
  return <output>{currentStore.config.businessHours}</output>;
}
const vault = {
  getById: vi.fn(async () => ({ id: "singleton", businessHours: "Antigo" })),
  getAll: vi.fn(async () => []),
  put: h.put,
};
let root: Root;
let host: HTMLDivElement;
let pending: ReturnType<typeof deferred<{ data: unknown; error: unknown }>>;
async function render(active = true, editor = true) {
  await act(async () =>
    root.render(
      <StoreProvider>
        <Observe />
        {editor && (
          <AdminSettingsView
            active={active}
            onNavigate={vi.fn()}
            onSetDirty={h.dirty}
          />
        )}
      </StoreProvider>,
    ),
  );
}
function button(label: string) {
  const result = [...host.querySelectorAll("button")].find(
    (el) => el.textContent === label,
  );
  expect(result).toBeDefined();
  return result!;
}
// Vocabulário SALÃO+PORÃO (13/09): a seção do horário se chama "Atendimento"
// e o cabeçalho carrega a linha de estado no textContent — a abertura não é
// por texto exato, é por cabeçalho de acordeão (aria-expanded) + título.
function secao(titulo: string) {
  const result = [...host.querySelectorAll("button")].find(
    (el) =>
      el.getAttribute("aria-expanded") !== null &&
      el.textContent?.includes(titulo),
  );
  expect(result, `seção ausente: ${titulo}`).toBeDefined();
  return result!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function abrirSecao(titulo: string) {
  await act(async () => secao(titulo).click());
}
function field() {
  return host.querySelector<HTMLInputElement>("#store-business-hours")!;
}
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(field(), value);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function start() {
  await abrirSecao("Atendimento");
  await type("Escolha de A");
  await click("Salvar horário");
}
async function confirm() {
  await act(async () =>
    pending.resolve({ data: { business_hours: "Escolha de A" }, error: null }),
  );
}
function user(id: string) {
  h.auth = { ...h.auth, user: { id }, session: { user: { id } } };
}
function noDelivery() {
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
  expect(store.config.businessHours).toBe("Antigo");
  expect(h.put).not.toHaveBeenCalled();
  expect(h.rpc).toHaveBeenCalledTimes(1);
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  user("a");
  h.auth.isAdmin = true;
  h.init.mockReset().mockResolvedValue(vault);
  h.put.mockReset().mockResolvedValue(undefined);
  pending = deferred();
  h.rpc.mockReset().mockReturnValue(pending.promise);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render();
  h.put.mockClear();
  h.dirty.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("horário com editor e StoreProvider reais", () => {
  it("A → B antes do retorno não entrega estado, cache ou aviso de A", async () => {
    await start();
    user("b");
    await render();
    await type("B editando");
    await confirm();
    noDelivery();
    expect(field().value).toBe("B editando");
  });
  it("confirma com uma RPC, somente business_hours e um aviso", async () => {
    await start();
    await confirm();
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("upsert_store_config", {
      config_json: { business_hours: "Escolha de A" },
    });
    expect(toast.success).toHaveBeenCalledExactlyOnceWith(
      "Horário de atendimento salvo",
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(store.config.businessHours).toBe("Escolha de A");
    expect(h.put).toHaveBeenCalledWith(
      "store_config",
      expect.objectContaining({ businessHours: "Escolha de A" }),
    );
    expect(h.dirty).toHaveBeenLastCalledWith(false);
  });
  it("A → B → A não ressuscita a operação", async () => {
    await start();
    user("b");
    await render();
    user("a");
    await render();
    await confirm();
    noDelivery();
    expect(field().value).toBe("Antigo");
  });
  it("inactive → active preserva texto e permite nova operação sem ressuscitar a anterior", async () => {
    await start();
    await render(false);
    await render(true);
    expect(field().value).toBe("Escolha de A");
    expect(button("Salvar horário").disabled).toBe(false);
    await confirm();
    noDelivery();
    expect(h.dirty).toHaveBeenLastCalledWith(true);
    const next = deferred<{ data: unknown; error: unknown }>();
    h.rpc.mockReturnValue(next.promise);
    await type("Escolha nova");
    await click("Salvar horário");
    await act(async () =>
      next.resolve({ data: { business_hours: "Escolha nova" }, error: null }),
    );
    expect(store.config.businessHours).toBe("Escolha nova");
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
  it("retorno antigo não destrava nem limpa a operação seguinte", async () => {
    await start();
    await render(false);
    await render(true);
    const next = deferred<{ data: unknown; error: unknown }>();
    h.rpc.mockReturnValue(next.promise);
    await type("Nova tentativa");
    await click("Salvar horário");
    await confirm();
    expect(button("Salvando…").disabled).toBe(true);
    expect(field().value).toBe("Nova tentativa");
    expect(store.config.businessHours).toBe("Antigo");
    expect(toast.success).not.toHaveBeenCalled();
    expect(h.put).not.toHaveBeenCalled();
    await act(async () =>
      next.resolve({ data: { business_hours: "Nova tentativa" }, error: null }),
    );
    expect(store.config.businessHours).toBe("Nova tentativa");
    expect(h.dirty).toHaveBeenLastCalledWith(false);
  });
  it("horário vazio envia null e confirma ausência sem perder o contrato", async () => {
    await abrirSecao("Atendimento");
    await type("   ");
    await click("Salvar horário");
    await act(async () =>
      pending.resolve({ data: { business_hours: null }, error: null }),
    );
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("upsert_store_config", {
      config_json: { business_hours: null },
    });
    expect(store.config.businessHours).toBeNull();
    expect(field().value).toBe("");
    expect(h.dirty).toHaveBeenLastCalledWith(false);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
  it("desmontar somente o editor invalida os efeitos no provider que permanece", async () => {
    await start();
    await render(true, false);
    await confirm();
    noDelivery();
  });
  it.each(["erro", "retorno divergente"])(
    "%s mantém texto e pendência sem aviso duplicado",
    async (kind) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      await start();
      await act(async () =>
        pending.resolve(
          kind === "erro"
            ? { data: null, error: { message: "segredo externo" } }
            : { data: { business_hours: "Outro" }, error: null },
        ),
      );
      expect(field().value).toBe("Escolha de A");
      expect(host.querySelector('[role="alert"]')).not.toBeNull();
      expect(host.textContent).not.toContain("segredo externo");
      expect(h.dirty).toHaveBeenLastCalledWith(true);
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      expect(store.config.businessHours).toBe("Antigo");
      expect(h.put).not.toHaveBeenCalled();
    },
  );
  it("DataVault.init pendente não grava depois da troca de usuário", async () => {
    const cache = deferred<typeof vault>();
    h.init.mockReturnValue(cache.promise);
    await start();
    await confirm();
    expect(store.config.businessHours).toBe("Escolha de A");
    user("b");
    await render();
    await act(async () => cache.resolve(vault));
    expect(h.put).not.toHaveBeenCalled();
  });
  it("erro tardio do cache invalidado não divulga aviso", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cache = deferred<typeof vault>();
    h.init.mockReturnValue(cache.promise);
    await start();
    await confirm();
    user("b");
    await render();
    await act(async () => cache.reject(new Error("cache antigo")));
    expect(warn).not.toHaveBeenCalled();
    expect(h.put).not.toHaveBeenCalled();
  });
  it("RPC rejeitada depois de troca não emite erro antigo", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await start();
    user("b");
    await render();
    await act(async () => pending.reject(new Error("sessão antiga")));
    noDelivery();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("opção de vida útil do StoreProvider real", () => {
  it.each(["false", "throw", "truthy"])(
    "guarda %s antes da RPC falha fechado sem efeitos",
    async (kind) => {
      h.rpc.mockResolvedValue({
        data: { business_hours: "Novo" },
        error: null,
      });
      const isCurrent = () => {
        if (kind === "throw") throw new Error("guard");
        return (kind === "truthy" ? 1 : false) as boolean;
      };
      let result: boolean | undefined;
      await act(async () => {
        result = await store.updateConfig(
          { businessHours: "Novo" },
          { isCurrent },
        );
      });
      expect(result).toBe(false);
      expect(h.rpc).not.toHaveBeenCalled();
      expect(h.put).not.toHaveBeenCalled();
      expect(store.config.businessHours).toBe("Antigo");
      expect(toast.error).not.toHaveBeenCalled();
    },
  );
  it("captura callback e silent antes do await mesmo se options for mutado", async () => {
    let current = true;
    const options = { isCurrent: () => current, silent: true };
    let result!: Promise<boolean>;
    await act(async () => {
      result = store.updateConfig(
        { businessHours: "Escolha de A", primaryColor: "#FF0000" },
        options,
      );
    });
    const color = document.documentElement.style.getPropertyValue("--primary");
    current = false;
    options.isCurrent = () => true;
    options.silent = false;
    await act(async () =>
      pending.resolve({
        data: { business_hours: "Escolha de A", primary_color: "#FF0000" },
        error: null,
      }),
    );
    expect(await result).toBe(false);
    noDelivery();
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
      color,
    );
  });
  it("silent capturado continua silencioso em sucesso válido", async () => {
    const options = { isCurrent: () => true, silent: true };
    let result!: Promise<boolean>;
    await act(async () => {
      result = store.updateConfig({ businessHours: "Escolha de A" }, options);
    });
    options.silent = false;
    await confirm();
    expect(await result).toBe(true);
    expect(store.config.businessHours).toBe("Escolha de A");
    expect(toast.success).not.toHaveBeenCalled();
    expect(h.put).toHaveBeenCalled();
  });
  it("guarda que lança após RPC não escapa nem entrega cor ou erro", async () => {
    let valid = true;
    let result!: Promise<boolean>;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      result = store.updateConfig(
        { businessHours: "Escolha de A" },
        {
          isCurrent: () => {
            if (!valid) throw new Error("guard");
            return true;
          },
        },
      );
    });
    valid = false;
    await confirm();
    expect(await result).toBe(false);
    noDelivery();
    expect(error).not.toHaveBeenCalled();
  });
  it("sem options mantém estado, cache e aviso dos escritores existentes", async () => {
    let result!: Promise<boolean>;
    await act(async () => {
      result = store.updateConfig({ businessHours: "Escolha de A" });
    });
    await confirm();
    expect(await result).toBe(true);
    expect(store.config.businessHours).toBe("Escolha de A");
    expect(h.put).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledExactlyOnceWith(
      "Configurações salvas",
    );
  });
  it("guarda válida e silent não dispensam permissão administrativa", async () => {
    h.auth.isAdmin = false;
    await render();
    let result: boolean | undefined;
    await act(async () => {
      result = await store.updateConfig(
        { businessHours: "Novo" },
        { isCurrent: () => true, silent: true },
      );
    });
    expect(result).toBe(false);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.put).not.toHaveBeenCalled();
    expect(store.config.businessHours).toBe("Antigo");
    expect(toast.error).not.toHaveBeenCalled();
  });
});
