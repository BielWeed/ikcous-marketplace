// @vitest-environment jsdom
import { AdminFreeShippingCardView } from "@/views/admin/AdminFreeShippingCardView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const estado = vi.hoisted(() => ({
  style: "completo",
  offline: false,
  loaded: true,
  updateConfig: vi.fn(),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { freeShippingCardStyle: estado.style },
    isLoaded: estado.loaded,
    updateConfig: estado.updateConfig,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => estado.offline,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// @ts-expect-error flag interna do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
describe("escolha do card de frete", () => {
  let root: Root;
  let container: HTMLDivElement;
  const dirty = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    estado.style = "completo";
    estado.offline = false;
    estado.loaded = true;
    estado.updateConfig.mockReset().mockResolvedValue(true);
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => act(() => root.unmount()));
  function montar(active = true) {
    act(() =>
      root.render(
        <AdminFreeShippingCardView active={active} onSetDirty={dirty} />,
      ),
    );
  }
  function radio(style: string) {
    return container.querySelector<HTMLInputElement>(
      `input[value="${style}"]`,
    )!;
  }
  function salvar() {
    return [...container.querySelectorAll("button")].find((x) =>
      x.textContent?.includes("Salvar"),
    )!;
  }
  it("começa no estilo salvo com prévias e sem alteração pendente", () => {
    montar();
    expect(radio("completo").checked).toBe(true);
    expect(container.textContent).toContain("129,90 / 150,00");
    expect(salvar().matches(":disabled")).toBe(true);
    expect(dirty).toHaveBeenLastCalledWith(false);
  });
  it("escolher não grava; salvar envia somente estilo e confirma o estado salvo", async () => {
    montar();
    act(() => radio("compacto").click());
    expect(dirty).toHaveBeenLastCalledWith(true);
    expect(estado.updateConfig).not.toHaveBeenCalled();
    await act(async () => salvar().click());
    expect(estado.updateConfig).toHaveBeenCalledWith(
      { freeShippingCardStyle: "compacto" },
      { silent: true },
    );
    expect(toast.success).toHaveBeenCalledOnce();
    expect(dirty).toHaveBeenLastCalledWith(false);
    expect(salvar().matches(":disabled")).toBe(true);
  });
  it("offline mantém a prévia mas impede gravar", () => {
    estado.offline = true;
    montar();
    act(() => radio("compacto").click());
    expect(container.textContent).toContain("Sem conexão");
    expect(salvar().matches(":disabled")).toBe(true);
    expect(estado.updateConfig).not.toHaveBeenCalled();
  });
  it.each([false, "throw"])(
    "falha %s conserva a escolha pendente e avisa, sem sucesso",
    async (resultado) => {
      if (resultado === false) estado.updateConfig.mockResolvedValue(false);
      else estado.updateConfig.mockRejectedValue(new Error("rede"));
      montar();
      act(() => radio("compacto").click());
      await act(async () => salvar().click());
      expect(toast.error).toHaveBeenCalledOnce();
      expect(toast.success).not.toHaveBeenCalled();
      expect(dirty).toHaveBeenLastCalledWith(true);
      expect(radio("compacto").checked).toBe(true);
      expect(salvar().disabled).toBe(false);
    },
  );
  it("duplo toque só grava uma vez e não deixa escolher durante a gravação", async () => {
    let resolver!: (ok: boolean) => void;
    estado.updateConfig.mockReturnValue(
      new Promise<boolean>((r) => (resolver = r)),
    );
    montar();
    act(() => radio("compacto").click());
    act(() => {
      salvar().click();
      salvar().click();
    });
    expect(estado.updateConfig).toHaveBeenCalledTimes(1);
    expect(radio("completo").matches(":disabled")).toBe(true);
    await act(async () => resolver(true));
  });
  it("configuração tardia não apaga a escolha local; ao voltar sem edição acompanha a loja", () => {
    montar();
    act(() => radio("compacto").click());
    estado.style = "compacto";
    montar();
    expect(radio("compacto").checked).toBe(true);
    expect(dirty).toHaveBeenLastCalledWith(false);
    estado.style = "completo";
    montar();
    expect(radio("completo").checked).toBe(true);
  });
  it("aguarda carregar e não salva quando a tela está inativa", () => {
    estado.loaded = false;
    montar();
    expect(salvar().matches(":disabled")).toBe(true);
    estado.loaded = true;
    montar(false);
    expect(radio("compacto").matches(":disabled")).toBe(true);
  });
});
