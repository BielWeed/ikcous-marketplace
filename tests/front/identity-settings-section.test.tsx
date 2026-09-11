import { IdentitySettingsSection } from "@/components/admin/settings/IdentitySettingsSection";
import type {
  IdentityAdminOptions,
  StoreIdentityIntent,
} from "@/lib/adminStoreIdentity";
// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  prepare: vi.fn(),
  upload: vi.fn(),
  refresh: vi.fn(),
  update: vi.fn(),
  dirty: vi.fn(),
  origin: "https://abcdefghijklmnopqrst.supabase.co",
  auth: {
    user: { id: "admin-a" },
    isAdmin: true,
    adminStatus: "admin",
    session: { user: { id: "admin-a" }, access_token: "synthetic-session" },
  },
  config: { businessHours: "Antigo", shippingFee: 1 },
  version: 0,
  listeners: new Set<() => void>(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@/contexts/StoreContext", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useStore: () => {
      useSyncExternalStore(
        (cb) => {
          h.listeners.add(cb);
          return () => {
            h.listeners.delete(cb);
          };
        },
        () => h.version,
      );
      return {
        config: h.config,
        isLoaded: true,
        updateConfig: h.update,
        refresh: h.refresh,
      };
    },
  };
});
vi.mock("@/lib/env-valores", () => ({
  lerSupabaseUrl: () => h.origin,
  lerChaveSupabase: () => "sb_publishable_synthetic",
}));
vi.mock("@/lib/adminStoreIdentity", () => ({
  readAdminStoreIdentity: h.read,
  saveAdminStoreIdentity: h.save,
}));
vi.mock("@/lib/prepareIdentityImage", () => ({
  prepareIdentityImage: h.prepare,
}));
vi.mock("@/lib/uploadIdentityImage", () => ({ uploadIdentityImage: h.upload }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// @ts-expect-error React testing flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function asset(
  name: string,
  width?: number,
  height?: number,
  media_type = "image/png",
) {
  return {
    path: `v1/${"a".repeat(64)}/${name}`,
    sha256: "a".repeat(64),
    bytes: 100,
    media_type,
    ...(width === undefined ? {} : { width, height }),
  };
}
function snapshot() {
  return {
    revision: "9007199254740993",
    identity: {
      store_name: "Loja Teste",
      store_city: "Uberlândia",
      store_state: "MG",
      primary_color: "#ABCDEF",
      secondary_color: "#000000",
      accent_color: "#000000",
      logo_url: `${h.origin}/storage/v1/object/public/branding/${asset("header.svg").path}`,
      branding_assets: {
        version: 1,
        originals: [asset("source.svg", undefined, undefined, "image/svg+xml")],
        header: asset("header.svg", undefined, undefined, "image/svg+xml"),
        loader: asset("loader.svg", undefined, undefined, "image/svg+xml"),
        favicon: asset(
          "favicon.ico",
          undefined,
          undefined,
          "image/vnd.microsoft.icon",
        ),
        apple_touch: asset("apple.png", 180, 180),
        icon_192: asset("192.png", 192, 192),
        icon_512: asset("512.png", 512, 512),
        maskable_512: asset("mask.png", 512, 512),
        og: asset("og.png", 1200, 630),
      },
    },
  };
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let root: Root;
let host: HTMLDivElement;
let mounted = true;
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function render(active = true) {
  await act(async () => {
    root.render(
      <IdentitySettingsSection active={active} onDirtyChange={h.dirty} />,
    );
  });
  await flush();
}
function input(id: string) {
  const el = host.querySelector<HTMLInputElement>(`#${id}`);
  expect(el).not.toBeNull();
  return el!;
}
function button(text: string) {
  const el = [...host.querySelectorAll("button")].find(
    (node) => node.textContent === text,
  );
  expect(el).toBeDefined();
  return el!;
}
function fileInput(label: string) {
  const id = `identity-upload-${encodeURIComponent(label)}`;
  const el = [
    ...host.querySelectorAll<HTMLInputElement>('input[type="file"]'),
  ].find((node) => node.id === id);
  expect(el).toBeDefined();
  return el!;
}
async function click(text: string) {
  await act(async () => {
    button(text).click();
  });
  await flush();
}
async function type(id: string, value: string) {
  await act(async () => {
    const el = input(id);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function select(
  label = "Trocar cabeçalho",
  file = new File(["unaltered-file"], "original.svg", {
    type: "image/svg+xml",
  }),
) {
  const el = [
    ...host.querySelectorAll<HTMLInputElement>('input[type="file"]'),
  ].find((node) => node.id === `identity-upload-${encodeURIComponent(label)}`)!;
  expect(el).toBeDefined();
  await act(async () => {
    Object.defineProperty(el, "files", { configurable: true, value: [file] });
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
  return file;
}
beforeEach(() => {
  vi.clearAllMocks();
  h.read.mockReset();
  h.save.mockReset();
  h.prepare.mockReset();
  h.upload.mockReset();
  h.refresh.mockResolvedValue(undefined);
  h.origin = "https://abcdefghijklmnopqrst.supabase.co";
  h.auth = {
    user: { id: "admin-a" },
    isAdmin: true,
    adminStatus: "admin",
    session: { user: { id: "admin-a" }, access_token: "synthetic-session" },
  };
  h.config = { businessHours: "Antigo", shippingFee: 1 };
  h.read.mockImplementation(async () => snapshot());
  h.save.mockImplementation(async (intent: StoreIdentityIntent) => ({
    status: "confirmed",
    source: "response",
    snapshot: { revision: "9007199254740994", identity: intent.desired },
  }));
  h.prepare.mockImplementation(async (file: File) => ({
    blob: file,
    asset: asset("new.svg", undefined, undefined, "image/svg+xml"),
  }));
  h.upload.mockImplementation(async (image) => ({
    asset: image.asset,
    url: `${h.origin}/storage/v1/object/public/branding/${image.asset.path}`,
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mounted = true;
});
afterEach(() => {
  if (mounted) act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("editor de identidade sobre fotografia RPC", () => {
  it("carrega somente RPC e preserva nome/cor digitados ao publicar config externa", async () => {
    await render();
    await type("store-name", "Meu rascunho");
    await type("store-color-hex", "#0");
    await act(async () => {
      h.config = { businessHours: "Outro", shippingFee: 99 };
      h.version++;
      for (const listener of h.listeners) listener();
    });
    expect(input("store-name").value).toBe("Meu rascunho");
    expect(input("store-color-hex").value).toBe("#0");
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.save).not.toHaveBeenCalled();
    expect(h.dirty).toHaveBeenLastCalledWith(true);
  });
  it("não inicia leitura sem administrador coerente", async () => {
    h.auth.isAdmin = false;
    await render();
    expect(h.read).not.toHaveBeenCalled();
    expect(host.textContent).toContain("sessão de administrador");
  });
  it("sessão de outro usuário não lê", async () => {
    h.auth.session.user.id = "outro";
    await render();
    expect(h.read).not.toHaveBeenCalled();
  });
  it("identidade incompleta bloqueia upload e save sem fallback config/build", async () => {
    h.read.mockResolvedValue({
      ...snapshot(),
      identity: { ...snapshot().identity, branding_assets: null },
    });
    await render();
    expect(host.textContent).toContain("preparação inicial");
    expect(host.querySelector('input[type="file"]')).toBeNull();
    expect(h.save).not.toHaveBeenCalled();
  });
  it("erro de leitura é fixo e nova tentativa é somente leitura", async () => {
    h.read.mockRejectedValueOnce(new Error("PRIVATE_SERVER_MESSAGE"));
    await render();
    expect(host.textContent).not.toContain("PRIVATE_SERVER_MESSAGE");
    await click("Tentar novamente");
    expect(input("store-name").value).toBe("Loja Teste");
    expect(h.read).toHaveBeenCalledTimes(2);
    expect(h.save).not.toHaveBeenCalled();
  });
  it("renovação do mesmo usuário conserva rascunho e authorize usa sessão recente", async () => {
    await render();
    await type("store-name", "Novo");
    h.auth.session = {
      user: { id: "admin-a" },
      access_token: "renewed-synthetic",
    };
    await render();
    await click("Salvar identidade");
    const options = h.save.mock.calls[0][1] as IdentityAdminOptions;
    expect(options.userId).toBe("admin-a");
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0][0].desired.store_name).toBe("Novo");
  });
  it("salva uma intenção, bloqueia clique duplicado e edição, atualiza somente leitura uma vez", async () => {
    const request = deferred<unknown>();
    h.save.mockReturnValue(request.promise);
    await render();
    await type("store-name", "Novo");
    await click("Salvar identidade");
    expect(input("store-name").disabled).toBe(false);
    expect(input("store-name").closest("fieldset")?.disabled).toBe(true);
    await act(async () => button("Salvando identidade…").click());
    expect(h.save).toHaveBeenCalledTimes(1);
    const intent = h.save.mock.calls[0][0];
    await act(async () =>
      request.resolve({
        status: "confirmed",
        source: "response",
        snapshot: { revision: "9007199254740994", identity: intent.desired },
      }),
    );
    expect(h.refresh).toHaveBeenCalledExactlyOnceWith({ onlyConfig: true });
    expect(h.update).not.toHaveBeenCalled();
    expect(h.dirty).toHaveBeenLastCalledWith(false);
    expect(host.textContent).toContain("próxima atualização");
  });
  it("falha do refresh não desfaz confirmação", async () => {
    h.refresh.mockRejectedValue(new Error("secret"));
    await render();
    await type("store-name", "Novo");
    await click("Salvar identidade");
    expect(host.textContent).toContain("Identidade salva no cadastro");
    expect(h.dirty).toHaveBeenLastCalledWith(false);
  });
  it.each(["#000000", "verde", "#0"])(
    "recusa primária %s antes da RPC",
    async (value) => {
      await render();
      await type("store-color-hex", value);
      await click("Salvar identidade");
      expect(h.save).not.toHaveBeenCalled();
      expect(input("store-color-hex").value).toBe(value);
    },
  );
  it("aceita preto secundário/destaque e normaliza cores pelo codec", async () => {
    await render();
    await type("store-color-hex", "#ff5733");
    await click("Salvar identidade");
    expect(h.save.mock.calls[0][0].desired).toMatchObject({
      primary_color: "#FF5733",
      secondary_color: "#000000",
      accent_color: "#000000",
    });
  });
  it("rejeição preserva rascunho sem anunciar sucesso", async () => {
    h.save.mockResolvedValue({ status: "rejected", code: "permission" });
    await render();
    await type("store-name", "Não perdido");
    await click("Salvar identidade");
    expect(input("store-name").value).toBe("Não perdido");
    expect(h.refresh).not.toHaveBeenCalled();
    expect(host.textContent).toContain("não foi gravada");
  });
  it("descartar requer escolha explícita e retorna à fotografia sem rede", async () => {
    await render();
    await type("store-name", "Novo");
    await click("Descartar alterações");
    expect(input("store-name").value).toBe("Novo");
    await click("Sim, descartar rascunho");
    expect(input("store-name").value).toBe("Loja Teste");
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(h.save).not.toHaveBeenCalled();
  });
});

describe("cancelamento, concorrência e resposta incerta", () => {
  it("trocar projeto rejeita upload tardio e carrega somente a nova fotografia", async () => {
    const old = deferred<unknown>();
    h.upload.mockReturnValueOnce(old.promise);
    await render();
    await select();
    const options = h.upload.mock.calls[0][1];
    h.origin = "https://zyxwvutsrqponmlkjihg.supabase.co";
    await render();
    await act(async () =>
      old.resolve({
        asset: asset("bad.svg", undefined, undefined, "image/svg+xml"),
        url: "https://invalid.test",
      }),
    );
    expect(options.signal.aborted).toBe(true);
    expect(h.save).not.toHaveBeenCalled();
    expect(
      host
        .querySelector('section[aria-label="Prévia: Cabeçalho"] img')
        ?.getAttribute("src"),
    ).toContain("zyxwvutsrqponmlkjihg");
  });
  it("authorize resolve a sessão renovada enquanto a operação está ativa", async () => {
    let captured = "";
    h.save.mockImplementation(
      async (intent: StoreIdentityIntent, options: IdentityAdminOptions) => {
        captured = (await options.authorize()).accessToken;
        return {
          status: "confirmed",
          source: "response",
          snapshot: { revision: "2", identity: intent.desired },
        };
      },
    );
    await render();
    await type("store-name", "Novo");
    h.auth.session = {
      user: { id: "admin-a" },
      access_token: "renewed-fixture",
    };
    await render();
    await click("Salvar identidade");
    expect(captured).toBe("renewed-fixture");
  });
  it.each(["same", "different", "failure"])(
    "pendência só relê: %s",
    async (answer) => {
      h.save.mockResolvedValue({ status: "pending", reason: "unconfirmed" });
      await render();
      await type("store-name", "Meu nome");
      await click("Salvar identidade");
      expect(button("Salvar identidade").disabled).toBe(true);
      if (answer === "same")
        h.read.mockResolvedValue({
          revision: "7",
          identity: h.save.mock.calls[0][0].desired,
        });
      else if (answer === "failure")
        h.read.mockRejectedValue(new Error("private"));
      else h.read.mockResolvedValue(snapshot());
      await click("Conferir novamente");
      expect(h.save).toHaveBeenCalledTimes(1);
      expect(h.read).toHaveBeenCalledTimes(2);
      expect(host.textContent).toContain(
        answer === "same"
          ? "Esta identidade está salva"
          : answer === "different"
            ? "Outra configuração"
            : "confirmação está pendente",
      );
    },
  );
  it("conflito só concilia após clique e preserva cidade externa não tocada", async () => {
    const current = snapshot();
    current.revision = "4";
    current.identity.store_city = "Cidade externa";
    h.save.mockResolvedValue({
      status: "conflict",
      source: "readback",
      current,
    });
    await render();
    await type("store-name", "Meu nome");
    await click("Salvar identidade");
    expect(input("store-city").value).toBe("Uberlândia");
    await click("Revisar meu rascunho");
    expect(input("store-city").value).toBe("Cidade externa");
    expect(input("store-name").value).toBe("Meu nome");
    expect(h.save).toHaveBeenCalledTimes(1);
    await click("Salvar identidade");
    expect(h.save.mock.calls[1][0].expected.revision).toBe("4");
  });
  it("conflito do servidor exige leitura antes de conciliar", async () => {
    h.save.mockResolvedValue({ status: "conflict", source: "server" });
    await render();
    await type("store-name", "Meu nome");
    await click("Salvar identidade");
    expect(host.textContent).not.toContain("Revisar meu rascunho");
    await click("Conferir configuração atual");
    await click("Usar configuração atual");
    expect(input("store-name").value).toBe("Loja Teste");
    expect(h.save).toHaveBeenCalledTimes(1);
  });
  it("inativar durante save conserva pendência e rejeita confirmação tardia", async () => {
    const old = deferred<unknown>();
    h.save.mockReturnValue(old.promise);
    await render();
    await type("store-name", "Rascunho");
    await click("Salvar identidade");
    const options = h.save.mock.calls[0][1];
    await render(false);
    expect(options.signal.aborted).toBe(true);
    await act(async () =>
      old.resolve({
        status: "confirmed",
        source: "response",
        snapshot: { revision: "2", identity: h.save.mock.calls[0][0].desired },
      }),
    );
    await render(true);
    expect(host.textContent).toContain("confirmação está pendente");
    expect(input("store-name").value).toBe("Rascunho");
    expect(h.refresh).not.toHaveBeenCalled();
    expect(button("Salvar identidade").disabled).toBe(true);
  });
  it("trocar usuário retira rascunho antigo e impede A de substituir B", async () => {
    const old = deferred<unknown>();
    h.read.mockReturnValueOnce(old.promise);
    await render();
    const options = h.read.mock.calls[0][0];
    h.auth = {
      ...h.auth,
      user: { id: "admin-b" },
      session: { user: { id: "admin-b" }, access_token: "synthetic-b" },
    };
    await render();
    await type("store-name", "B editando");
    await act(async () => old.resolve(snapshot()));
    expect(input("store-name").value).toBe("B editando");
    expect(options.isCurrent()).toBe(false);
    expect(options.signal.aborted).toBe(true);
  });
  it("perda de admin retira dados e save tardio não refresca", async () => {
    const old = deferred<unknown>();
    h.save.mockReturnValue(old.promise);
    await render();
    await type("store-name", "Privado");
    await click("Salvar identidade");
    h.auth.isAdmin = false;
    await render();
    await act(async () =>
      old.resolve({
        status: "confirmed",
        snapshot: snapshot(),
        source: "response",
      }),
    );
    expect(host.textContent).not.toContain("Privado");
    expect(h.refresh).not.toHaveBeenCalled();
  });
  it("desmontar cancela leitura e bloqueia callback tardio", async () => {
    const old = deferred<unknown>();
    h.read.mockReturnValue(old.promise);
    await render();
    const options = h.read.mock.calls[0][0];
    act(() => root.unmount());
    mounted = false;
    await act(async () => old.resolve(snapshot()));
    expect(options.signal.aborted).toBe(true);
    expect(h.refresh).not.toHaveBeenCalled();
  });
});

describe("imagem original e fontes explícitas", () => {
  it("nove trocas comuns não aumentam a lista de fontes", async () => {
    await render();
    for (let index = 0; index < 9; index++) {
      h.prepare.mockResolvedValueOnce({
        blob: new Blob(["unchanged"]),
        asset: asset(
          `change${index}.svg`,
          undefined,
          undefined,
          "image/svg+xml",
        ),
      });
      await select();
    }
    await click("Salvar identidade");
    expect(h.upload).toHaveBeenCalledTimes(9);
    expect(h.save.mock.calls[0][0].desired.branding_assets.originals).toEqual(
      snapshot().identity.branding_assets.originals,
    );
  });
  it("adicionar e substituir fonte usam a mesma fila e a mesma conferência", async () => {
    await render();
    await select("Adicionar fonte");
    h.prepare.mockResolvedValueOnce({
      blob: new Blob(["replacement"]),
      asset: asset("replacement.svg", undefined, undefined, "image/svg+xml"),
    });
    await select("Substituir fonte 1");
    await click("Salvar identidade");
    expect(h.upload).toHaveBeenCalledTimes(2);
    expect(
      h.save.mock.calls[0][0].desired.branding_assets.originals.map(
        (item: { path: string }) => item.path.split("/").at(-1),
      ),
    ).toEqual(["replacement.svg", "new.svg"]);
  });
  it("duplicata em substituir fonte é recusada antes do envio", async () => {
    const snap = snapshot();
    snap.identity.branding_assets.originals.push(
      asset("new.svg", undefined, undefined, "image/svg+xml"),
    );
    h.read.mockResolvedValue(snap);
    await render();
    await select("Substituir fonte 1");
    expect(h.upload).not.toHaveBeenCalled();
    expect(h.save).not.toHaveBeenCalled();
  });
  it("preparador recebe o File original e upload só muda rascunho do cabeçalho", async () => {
    await render();
    const file = await select();
    expect(h.prepare.mock.calls[0][0]).toBe(file);
    expect(h.upload.mock.calls[0][0].blob).toBe(file);
    expect(h.save).not.toHaveBeenCalled();
    await click("Salvar identidade");
    const changed = h.save.mock.calls[0][0].desired.branding_assets;
    expect(changed.header.path).toContain("new.svg");
    expect(changed.loader).toEqual(snapshot().identity.branding_assets.loader);
    expect(changed.originals).toEqual(
      snapshot().identity.branding_assets.originals,
    );
    expect(changed.icon_512).toEqual(
      snapshot().identity.branding_assets.icon_512,
    );
  });
  it("usar também na abertura altera exatamente os dois papéis", async () => {
    await render();
    await act(async () =>
      host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
    );
    await select();
    await click("Salvar identidade");
    const changed = h.save.mock.calls[0][0].desired.branding_assets;
    expect(changed.header).toEqual(changed.loader);
    expect(changed.og).toEqual(snapshot().identity.branding_assets.og);
  });
  it("dimensão incompatível com papel não envia", async () => {
    await render();
    await select("Trocar ícone do aplicativo");
    expect(h.upload).not.toHaveBeenCalled();
    expect(host.textContent).toContain("formato e as dimensões");
  });
  it("erro do preparador não envia e permite selecionar o mesmo arquivo", async () => {
    h.prepare.mockRejectedValueOnce(new Error("PRIVATE"));
    await render();
    const file = await select();
    expect(h.upload).not.toHaveBeenCalled();
    await select("Trocar cabeçalho", file);
    expect(h.upload).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("PRIVATE");
  });
  it("cancelar A e iniciar B impede A tardio de alterar imagem ou progresso", async () => {
    const old = deferred<unknown>();
    h.upload.mockReturnValueOnce(old.promise);
    await render();
    await select();
    const options = h.upload.mock.calls[0][1];
    await click("Cancelar envio");
    await select();
    await act(async () => {
      options.onProgress({
        stage: "verifying",
        uploadedBytes: 100,
        totalBytes: 100,
      });
      old.resolve({
        asset: asset("old.svg", undefined, undefined, "image/svg+xml"),
        url: `${h.origin}/storage/v1/object/public/branding/${asset("old.svg").path}`,
      });
    });
    expect(options.signal.aborted).toBe(true);
    await click("Salvar identidade");
    expect(
      h.save.mock.calls[0][0].desired.branding_assets.header.path,
    ).toContain("new.svg");
  });
  it("upload em andamento bloqueia save e outros uploads; progresso só confirmado", async () => {
    const request = deferred<unknown>();
    h.upload.mockReturnValue(request.promise);
    await render();
    await select();
    const options = h.upload.mock.calls[0][1];
    expect(button("Salvar identidade").disabled).toBe(true);
    expect(
      [...host.querySelectorAll<HTMLInputElement>('input[type="file"]')].every(
        (el) => el.disabled,
      ),
    ).toBe(true);
    await act(async () =>
      options.onProgress({
        stage: "uploading",
        uploadedBytes: 6,
        totalBytes: 10,
      }),
    );
    expect(host.textContent).toContain("6 de 10 bytes confirmados");
    await act(async () =>
      options.onProgress({
        stage: "verifying",
        uploadedBytes: 10,
        totalBytes: 10,
      }),
    );
    expect(host.textContent).toContain("Conferindo imagem");
    await click("Cancelar envio");
  });
  it("inativar no preparo mantém imagem antiga e retorno preserva texto", async () => {
    const request = deferred<unknown>();
    h.prepare.mockReturnValue(request.promise);
    await render();
    await type("store-name", "Meu nome");
    await select();
    await render(false);
    await act(async () =>
      request.resolve({
        blob: new Blob(),
        asset: asset("late.svg", undefined, undefined, "image/svg+xml"),
      }),
    );
    await render();
    expect(input("store-name").value).toBe("Meu nome");
    expect(h.upload).not.toHaveBeenCalled();
    expect(
      host
        .querySelector('section[aria-label="Prévia: Cabeçalho"] img')
        ?.getAttribute("src"),
    ).toContain("header.svg");
  });
  it("oito fontes bloqueiam nona fonte mas não troca comum e nunca apagam bytes", async () => {
    const snap = snapshot();
    snap.identity.branding_assets.originals = Array.from(
      { length: 8 },
      (_, i) => asset(`source${i}.svg`, undefined, undefined, "image/svg+xml"),
    );
    h.read.mockResolvedValue(snap);
    await render();
    expect(host.textContent).toContain("Limite de oito fontes");
    await select();
    await click("Salvar identidade");
    expect(
      h.save.mock.calls[0][0].desired.branding_assets.originals,
    ).toHaveLength(8);
    expect(h.upload).toHaveBeenCalledTimes(1);
  });
  it("papel de compartilhamento aceita somente PNG; cabeçalho continua aceitando outros formatos", async () => {
    await render();
    expect(fileInput("Trocar compartilhamento").accept).toBe("image/png");
    expect(fileInput("Trocar cabeçalho").accept).toBe(
      "image/png,image/jpeg,image/webp,image/svg+xml,image/vnd.microsoft.icon,.ico",
    );
  });
  it("arquivo não-PNG no papel de compartilhamento devolve mensagem específica", async () => {
    await render();
    await select("Trocar compartilhamento");
    expect(h.upload).not.toHaveBeenCalled();
    expect(host.textContent).toContain(
      "A arte de compartilhamento precisa ser PNG, 1200 x 630.",
    );
  });
  it("arquivo não-PNG no cabeçalho não mostra a mensagem do papel de compartilhamento", async () => {
    await render();
    await select(
      "Trocar cabeçalho",
      new File(["jpeg"], "foto.jpg", { type: "image/jpeg" }),
    );
    expect(host.textContent).not.toContain(
      "A arte de compartilhamento precisa ser PNG, 1200 x 630.",
    );
  });
  it("PNG com dimensão errada no papel de compartilhamento mostra a mensagem genérica", async () => {
    await render();
    h.prepare.mockResolvedValueOnce({
      blob: new Blob(["png"]),
      asset: asset("og-errado.png", 600, 400, "image/png"),
    });
    await select(
      "Trocar compartilhamento",
      new File(["png"], "og-errado.png", { type: "image/png" }),
    );
    expect(h.upload).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain(
      "A arte de compartilhamento precisa ser PNG, 1200 x 630.",
    );
    expect(host.textContent).toContain("formato e as dimensões");
  });
  it("última fonte não pode sair; guardar referência não reenvia e retirada só muda lista", async () => {
    await render();
    expect(button("Retirar referência 1").disabled).toBe(true);
    await click("Guardar cabeçalho como fonte");
    expect(h.upload).not.toHaveBeenCalled();
    expect(button("Guardar cabeçalho como fonte").disabled).toBe(true);
    await click("Retirar referência 1");
    await click("Salvar identidade");
    expect(h.save.mock.calls[0][0].desired.branding_assets.originals).toEqual([
      snapshot().identity.branding_assets.header,
    ]);
  });
});
