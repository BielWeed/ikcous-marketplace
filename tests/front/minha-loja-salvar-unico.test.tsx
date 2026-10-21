import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @vitest-environment jsdom
// Componentes reais; só as fronteiras de gravação/leitura são dublês.
// Retirar o coordenador, paralelizar saves ou incluir horário no contato quebra estes casos.
import {
  ContextoDaBarra,
  useBarraAcoplada,
} from "@/components/layouts/AcaoDaBarra";
import type { StoreIdentityIntent } from "@/lib/adminStoreIdentity";
import { AdminAboutStoreView } from "@/views/admin/AdminAboutStoreView";
import { act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

const h = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  version: 0,
  listeners: new Set<() => void>(),
  update: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  refresh: vi.fn(),
  dirty: vi.fn(),
  offline: false,
  userId: "admin-a",
  toast: { success: vi.fn(), error: vi.fn() },
}));
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
        products: [],
      };
    },
  };
});
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => h.offline,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: h.userId },
    session: { user: { id: h.userId }, access_token: "synthetic-session" },
    isAdmin: true,
    adminStatus: "admin",
  }),
}));
vi.mock("@/lib/env-valores", () => ({
  lerSupabaseUrl: () => "https://abcdefghijklmnopqrst.supabase.co",
  lerChaveSupabase: () => "sb_publishable_synthetic",
}));
vi.mock("@/lib/adminStoreIdentity", () => ({
  readAdminStoreIdentity: h.read,
  saveAdminStoreIdentity: h.save,
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: h.toast }));
// @ts-expect-error flag interna do React.
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
    revision: "10",
    identity: {
      store_name: "Loja Teste",
      store_city: "São Paulo",
      store_state: "SP",
      primary_color: "#ABCDEF",
      secondary_color: "#000000",
      accent_color: "#000000",
      logo_url: `https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/branding/${asset("header.svg").path}`,
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
function Prateleira() {
  const barra = useContext(ContextoDaBarra);
  return (
    <nav>
      <div ref={barra?.receberPrateleira} data-prateleira />
    </nav>
  );
}
function Tela({ active = true }: { active?: boolean }) {
  const barra = useBarraAcoplada();
  return (
    <ContextoDaBarra.Provider value={barra}>
      <main>
        <AdminAboutStoreView
          active={active}
          onNavigate={vi.fn()}
          onSetDirty={h.dirty}
        />
      </main>
      <Prateleira />
    </ContextoDaBarra.Provider>
  );
}
let root: Root;
let host: HTMLDivElement;
let montado = true;
const pausa = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
function publicar(updates: Record<string, unknown>) {
  h.config = { ...h.config, ...updates };
  h.version++;
  for (const cb of h.listeners) cb();
}
beforeEach(() => {
  vi.clearAllMocks();
  h.offline = false;
  h.userId = "admin-a";
  h.config = {
    storeName: "Loja Teste",
    logoUrl: snapshot().identity.logo_url,
    originCep: "01310-100",
    storeAddress:
      "Avenida Paulista, 1578 — Bela Vista, São Paulo/SP — CEP 01310-100",
    storeCity: "São Paulo",
    storeState: "SP",
    whatsappNumber: "5511912345678",
    shareText: "Confira [nome]: [link]",
    businessHours: "Seg a sex, 9h às 18h",
    storeDescription: null,
  };
  h.update
    .mockReset()
    .mockImplementation(async (updates: Record<string, unknown>) => {
      publicar(updates);
      return true;
    });
  h.read.mockReset().mockResolvedValue(snapshot());
  h.save
    .mockReset()
    .mockImplementation(async (intent: StoreIdentityIntent) => ({
      status: "confirmed",
      source: "response",
      snapshot: { revision: "11", identity: intent.desired },
    }));
  h.refresh.mockResolvedValue(undefined);
  pararABuscaDeCep();
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  montado = true;
});
afterEach(() => {
  if (montado) act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function abrir(active = true) {
  await act(async () => {
    root.render(<Tela active={active} />);
    await pausa(30);
  });
  if (active) {
    for (
      let tentativa = 0;
      tentativa < 40 && !host.querySelector("#store-name");
      tentativa++
    ) {
      await act(async () => {
        await pausa(25);
      });
    }
    expect(host.querySelector("#store-name")).not.toBeNull();
  }
}
async function digitar(id: string, valor: string) {
  const campo = host.querySelector<HTMLInputElement>(`#${id}`)!;
  expect(campo).not.toBeNull();
  await act(async () => {
    campo.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
    campo.blur();
  });
  await act(async () => {
    await pausa(10);
  });
}
function salvar() {
  const button = host.querySelector<HTMLButtonElement>(
    '[aria-label="Ações de Minha loja"] button',
  );
  expect(button).not.toBeNull();
  return button!;
}
function bloco(titulo: string) {
  const section = [...host.querySelectorAll("section")].find(
    (s) => s.querySelector("h2")?.textContent === titulo,
  );
  expect(section).toBeDefined();
  return section!;
}
async function clicar() {
  await act(async () => {
    salvar().click();
    await pausa();
  });
}

it("sem edição: uma única ação, desabilitada e acoplada à navegação, com Tudo salvo", async () => {
  await abrir();
  expect(salvar().getAttribute("aria-disabled")).toBe("true");
  expect(salvar().textContent).toBe("Nada para salvar");
  expect(host.textContent).toContain("Tudo salvo");
  expect(salvar().closest("[data-prateleira]")).not.toBeNull();
  expect(
    [...host.querySelectorAll("button")].filter((b) =>
      /salvar|salvando/i.test(b.textContent ?? ""),
    ),
  ).toHaveLength(1);
});

it("contato e horário: conta dois blocos, salva uma vez cada EM SEQUÊNCIA e não grava os demais", async () => {
  await abrir();
  await digitar("settings-whatsapp", "11988887777");
  await digitar("store-business-hours", "Seg a sáb, 9h às 19h");
  expect(host.textContent).toContain("2 alterações para salvar");
  expect(host.textContent).toContain("Contato · Horário");
  expect(bloco("Contato").textContent).toContain("Alterado");
  expect(bloco("Horário de atendimento").textContent).toContain("Alterado");
  let liberar!: () => void;
  h.update.mockImplementationOnce(async (updates: Record<string, unknown>) => {
    await new Promise<void>((resolve) => {
      liberar = resolve;
    });
    publicar(updates);
    return true;
  });
  await clicar();
  expect(salvar().getAttribute("aria-disabled")).toBe("true");
  expect(salvar().textContent).toContain("Salvando");
  expect(h.update).toHaveBeenCalledTimes(1);
  expect(h.update.mock.calls[0][0]).toEqual({
    whatsappNumber: "5511988887777",
    shareText: "Confira [nome]: [link]",
  });
  expect(h.update.mock.calls[0][0]).not.toHaveProperty("businessHours");
  await act(async () => {
    liberar();
    await pausa();
  });
  expect(h.update).toHaveBeenCalledTimes(2);
  expect(h.update.mock.calls[1][0]).toEqual({
    businessHours: "Seg a sáb, 9h às 19h",
  });
  expect(h.save).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Tudo salvo");
  expect(h.dirty).toHaveBeenLastCalledWith(false);
  expect(bloco("Contato").textContent).not.toContain("Alterado");
  expect(bloco("Horário de atendimento").textContent).not.toContain("Alterado");
});

it("falha no contato não impede horário: erro identifica o bloco, preserva rascunho e só o contato fica alterado", async () => {
  await abrir();
  await digitar("settings-whatsapp", "11988887777");
  await digitar("store-business-hours", "Sáb, 9h às 12h");
  h.update.mockResolvedValueOnce(false);
  await clicar();
  expect(h.update).toHaveBeenCalledTimes(2);
  expect(bloco("Contato").querySelector('[role="alert"]')?.textContent).toMatch(
    /contato/i,
  );
  expect(bloco("Contato").textContent).toContain("Alterado");
  expect(bloco("Horário de atendimento").textContent).not.toContain("Alterado");
  expect(host.textContent).not.toContain("Tudo salvo");
  expect(host.textContent).toContain("1 alteração para salvar");
  expect(h.dirty).toHaveBeenLastCalledWith(true);
  expect(
    (host.querySelector("#settings-whatsapp") as HTMLInputElement).value,
  ).toContain("98888");
  await clicar();
  expect(h.update).toHaveBeenCalledTimes(3);
  expect(h.update.mock.calls[2][0]).not.toHaveProperty("businessHours");
  expect(host.textContent).toContain("Tudo salvo");
});

it.each([
  ["settings-whatsapp", "123", "Contato"],
  ["empresa-documento", "123", "Dados da empresa (opcional)"],
])(
  "%s inválido: o botão único executa a validação original e mantém o bloco alterado",
  async (id, valor, titulo) => {
    await abrir();
    await digitar(id, valor);
    await clicar();
    expect(h.update).not.toHaveBeenCalled();
    expect(bloco(titulo).querySelector('[role="alert"]')).not.toBeNull();
    expect(bloco(titulo).textContent).toContain("Alterado");
    expect(host.textContent).not.toContain("Tudo salvo");
    expect(salvar().disabled).toBe(false);
  },
);

it("marca e endereço compartilham a linha: endereço só grava depois da confirmação da marca", async () => {
  await abrir();
  await digitar("store-name", "Nova marca");
  await digitar("endereco-numero", "200");
  let confirmar!: () => void;
  h.save.mockImplementationOnce(async (intent: StoreIdentityIntent) => {
    await new Promise<void>((resolve) => {
      confirmar = resolve;
    });
    return {
      status: "confirmed",
      source: "response",
      snapshot: { revision: "11", identity: intent.desired },
    };
  });
  await clicar();
  expect(h.save).toHaveBeenCalledTimes(1);
  expect(h.update).not.toHaveBeenCalled();
  await act(async () => {
    confirmar();
    await pausa();
  });
  expect(h.update).toHaveBeenCalledTimes(1);
  expect(h.update.mock.calls[0][0]).toMatchObject({
    originCep: "01310-100",
    storeCity: "São Paulo",
    storeState: "SP",
  });
  expect(h.update.mock.calls[0][0]).not.toHaveProperty("storeName");
  expect(host.textContent).toContain("Tudo salvo");
});

it.each(["pending", "conflict", "rejected"])(
  "marca %s nunca é apresentada como Tudo salvo",
  async (status) => {
    await abrir();
    await digitar("store-name", "Nova marca");
    h.save.mockResolvedValueOnce({ status, source: "response" });
    await clicar();
    expect(
      bloco("Marca da loja").querySelector('[role="alert"]'),
    ).not.toBeNull();
    expect(bloco("Marca da loja").textContent).toContain("Alterado");
    expect(host.textContent).not.toContain("Tudo salvo");
  },
);

it("trocar de administrador durante a gravação não continua a fila nem entrega erro antigo", async () => {
  await abrir();
  await digitar("settings-whatsapp", "11988887777");
  await digitar("store-business-hours", "Sáb, 9h às 12h");
  let liberar!: () => void;
  h.update.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      liberar = resolve;
    });
    return false;
  });
  await clicar();
  expect(h.update).toHaveBeenCalledTimes(1);
  h.userId = "admin-b";
  await abrir();
  await act(async () => {
    liberar();
    await pausa();
  });
  expect(h.update).toHaveBeenCalledTimes(1);
  expect(bloco("Contato").querySelector('[role="alert"]')).toBeNull();
});

it("duplo clique no mesmo tick grava uma única vez", async () => {
  await abrir();
  await digitar("settings-whatsapp", "11988887777");
  const liberacoes: (() => void)[] = [];
  h.update.mockImplementation(async (updates: Record<string, unknown>) => {
    await new Promise<void>((resolve) => {
      liberacoes.push(resolve);
    });
    publicar(updates);
    return true;
  });
  const botao = salvar();
  await act(async () => {
    botao.click();
    botao.click();
  });
  const chamadas = h.update.mock.calls.length;
  await act(async () => {
    for (const liberar of liberacoes) liberar();
    await pausa();
  });
  expect(chamadas).toBe(1);
});

it("desmontar no meio da fila não grava o bloco seguinte", async () => {
  await abrir();
  await digitar("settings-whatsapp", "11988887777");
  await digitar("store-business-hours", "Sáb, 9h às 12h");
  let liberar!: () => void;
  h.update.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      liberar = resolve;
    });
    return true;
  });
  await clicar();
  expect(h.update).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
  montado = false;
  await act(async () => {
    liberar();
    await pausa();
  });
  expect(h.update).toHaveBeenCalledTimes(1);
});

it("salvar pelo teclado preserva foco no botão, inclusive quando termina Tudo salvo", async () => {
  await abrir();
  await digitar("settings-whatsapp", "11988887777");
  let liberar!: () => void;
  h.update.mockImplementationOnce(async (updates: Record<string, unknown>) => {
    await new Promise<void>((resolve) => {
      liberar = resolve;
    });
    publicar(updates);
    return true;
  });
  const botao = salvar();
  act(() => botao.focus());
  await clicar();
  expect(botao.disabled).toBe(false);
  expect(botao.getAttribute("aria-disabled")).toBe("true");
  expect(document.activeElement).toBe(botao);
  await act(async () => {
    liberar();
    await pausa();
  });
  expect(botao.disabled).toBe(false);
  expect(document.activeElement).toBe(botao);
  expect(
    host.querySelector('[aria-label="Ações de Minha loja"] [role="status"]')
      ?.textContent,
  ).toContain("Tudo salvo");
});

it("CNPJ inválido após outro bloco: reabilita o formulário antes de focar o campo com erro", async () => {
  await abrir();
  await digitar("settings-whatsapp", "11988887777");
  await digitar("empresa-documento", "123");
  let liberar!: () => void;
  h.update.mockImplementationOnce(async (updates: Record<string, unknown>) => {
    await new Promise<void>((resolve) => {
      liberar = resolve;
    });
    publicar(updates);
    return true;
  });
  act(() => salvar().focus());
  await clicar();
  expect(host.querySelector("fieldset")?.disabled).toBe(true);
  await act(async () => {
    liberar();
    await pausa();
  });
  expect(document.activeElement).toBe(host.querySelector("#empresa-documento"));
  expect(host.querySelector("fieldset")?.disabled).toBe(false);
  expect(
    host.querySelector('[aria-label="Ações de Minha loja"] [role="status"]')
      ?.textContent,
  ).toContain("1 alteração para salvar");
  expect(
    bloco("Dados da empresa (opcional)").querySelector('[role="alert"]'),
  ).not.toBeNull();
});

it("ação única usa o botão primário compartilhado, sem cores zinc que escapem dos temas", async () => {
  await abrir();
  expect(salvar().classList.contains("admin-barra-principal")).toBe(true);
  expect(salvar().className).not.toContain("disabled:bg-zinc-200");
  expect(salvar().className).not.toContain("hover:bg-zinc-800");
});

// Calcula sobre as declarações reais, incluindo o pior ponto do degradê,
// em vez de confundir jsdom (que não resolve variáveis CSS) com medição visual.
it("botão primário tem contraste AA em repouso, hover, foco e desabilitado nos três temas", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do CSS do próprio projeto
  const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do CSS de temas do próprio projeto
  const temas = readFileSync(
    resolve(process.cwd(), "src/components/layouts/temas-do-painel.css"),
    "utf8",
  );
  const regra = (seletor: string) => {
    const inicio = css.indexOf(`${seletor} {`);
    expect(inicio, seletor).toBeGreaterThan(-1);
    return css.slice(inicio, css.indexOf("}", inicio));
  };
  const normal = regra(
    ".admin-acoes-da-barra .admin-barra-principal:not(:disabled)",
  );
  const desabilitado = regra(
    '.admin-acoes-da-barra .admin-barra-principal[aria-disabled="true"]',
  );
  const foco = regra(
    ".admin-acoes-da-barra .admin-barra-principal:focus-visible",
  );
  expect(desabilitado).toContain("background: hsl(var(--admin-raised))");
  expect(desabilitado).toContain(
    "color: hsl(var(--admin-text-soft, 240 6.8% 65.5%))",
  );
  expect(foco).toContain(
    "outline-color: hsl(var(--admin-text-soft, 240 6.8% 65.5%))",
  );
  const hex = (valor: string) =>
    [1, 3, 5].map((i) => Number.parseInt(valor.slice(i, i + 2), 16));
  const hsl = (valor: string) => {
    const [h, s, l] = valor.trim().split(/\s+/).map(Number.parseFloat);
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    return [0, 8, 4].map((n) => {
      const k = (n + h / 30) % 12;
      return 255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
    });
  };
  const luminancia = (rgb: number[]) => {
    const linear = rgb.map((n) => {
      const v = n / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const contraste = (a: number[], b: number[]) => {
    const [claro, escuro] = [luminancia(a), luminancia(b)].sort(
      (x, y) => y - x,
    );
    return (claro + 0.05) / (escuro + 0.05);
  };
  const token = (fonte: string, seletor: string, nome: string) => {
    const inicio = fonte.indexOf(seletor);
    const bloco = fonte.slice(inicio, fonte.indexOf("}", inicio));
    // eslint-disable-next-line security/detect-non-literal-regexp -- nomes fechados dos tokens do próprio teste
    return bloco.match(new RegExp(`--admin-${nome}:\\s*([^;]+);`))![1];
  };
  const cores = normal.match(/linear-gradient\((#[a-f0-9]+), (#[a-f0-9]+)\)/)!;
  const de = hex(cores[1]);
  const ate = hex(cores[2]);
  const texto = hex(normal.match(/color: (#[a-f0-9]+)/)![1]);
  for (const tema of ["escuro", "claro", "confortavel"]) {
    const seletor = `html.admin-mode[data-admin-tema="${tema}"] {`;
    const elevado = hsl(
      token(
        tema === "escuro" ? css : temas,
        tema === "escuro" ? ":root {" : seletor,
        "raised",
      ),
    );
    const textoSuave = hsl(
      tema === "escuro" ? "240 6.8% 65.5%" : token(temas, seletor, "text-soft"),
    );
    const nav = hsl(
      token(
        tema === "escuro" ? css : temas,
        tema === "escuro" ? ":root {" : seletor,
        "nav",
      ),
    );
    const minimoNormal = Math.min(
      ...Array.from({ length: 101 }, (_, i) =>
        contraste(
          texto,
          // eslint-disable-next-line security/detect-object-injection -- índice numérico 0..2 dos canais RGB do degradê
          de.map((n, canal) => n + ((ate[canal] - n) * i) / 100),
        ),
      ),
    );
    const minimoDesabilitado = contraste(textoSuave, elevado);
    const minimoFoco = contraste(textoSuave, nav);
    expect(minimoNormal).toBeGreaterThanOrEqual(4.5);
    expect(minimoDesabilitado).toBeGreaterThanOrEqual(4.5);
    expect(minimoFoco).toBeGreaterThanOrEqual(4.5);
    console.info(
      `Contraste ${tema}: repouso/hover/foco ${minimoNormal.toFixed(2)}:1; desabilitado ${minimoDesabilitado.toFixed(2)}:1; contorno de foco ${minimoFoco.toFixed(2)}:1`,
    );
  }
});

it("tela inativa não ocupa a prateleira", async () => {
  await abrir(false);
  expect(host.querySelector("[data-prateleira]")?.childElementCount).toBe(0);
});
