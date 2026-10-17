// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  ligado: true,
  chave: "APP_USR-exemplo",
  loaded: true,
  offline: false,
  entrega: ["pix", "card", "cash"],
  ler: vi.fn(),
  salvar: vi.fn(),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { formasPagamentoEntrega: estado.entrega },
    isLoaded: estado.loaded,
    updateConfig: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => estado.offline,
}));
vi.mock("@/lib/flags", () => ({ pagamentoOnlineLigado: () => estado.ligado }));
vi.mock("@/config/configuracaoDaLoja", () => ({
  chavePublicaMercadoPago: () => estado.chave,
}));
vi.mock("@/lib/config-do-cartao", () => ({
  PARCELAS_MAX_TETO: 12,
  buscarConfigDoCartao: estado.ler,
  salvarConfigDoCartao: estado.salvar,
}));
vi.mock("@/components/admin/AdminPageHeader", () => ({
  AdminPageHeader: ({
    titulo,
    children,
  }: { titulo: string; children: React.ReactNode }) => (
    <>
      <h1>{titulo}</h1>
      {children}
    </>
  ),
}));
vi.mock("@/components/admin/AdminHelpModal", () => ({
  AdminHelpModal: () => null,
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AdminSettingsView } from "@/views/admin/AdminSettingsView";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  estado.ligado = true;
  estado.chave = "APP_USR-exemplo";
  estado.loaded = true;
  estado.offline = false;
  estado.entrega = ["pix", "card", "cash"];
  estado.ler.mockReset().mockResolvedValue({
    ok: true,
    config: { credito: true, debito: true, parcelasMax: 12 },
  });
  estado.salvar
    .mockReset()
    .mockResolvedValue({ credito: false, debito: true, parcelasMax: 12 });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function montar() {
  await act(async () =>
    root.render(<AdminSettingsView onNavigate={vi.fn()} />),
  );
}
async function clicar(label: string) {
  const button = host.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  expect(button, label).not.toBeNull();
  await act(async () => button!.click());
}
const resumo = () => host.querySelector('[aria-label="Recebimentos"]')!;

it("mostra PIX, cartão com parcelas e entrega antes dos seis grupos, sem duplicar a leitura do cartão", async () => {
  await montar();
  expect(resumo().textContent).toContain("Funcionando");
  expect(resumo().textContent).toContain("Crédito e débito · até 12x");
  expect(resumo().textContent).toContain("PIX, cartão e dinheiro");
  expect(
    [...resumo().querySelectorAll("dt")].map((el) => el.textContent),
  ).toEqual(["PIX", "Cartão ligado", "Na entrega"]);
  const grupos = [...host.querySelectorAll("[data-grupo-titulo]")];
  expect(grupos.map((el) => el.textContent)).toEqual([
    "Minha loja",
    "Aparência do app",
    "Entrega e frete",
    "Pagamentos",
    "Regras de troca e devolução",
    "Ferramentas",
  ]);
  expect(
    resumo().compareDocumentPosition(grupos[0]) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(estado.ler).toHaveBeenCalledTimes(1);
  await clicar("Gerenciar recebimentos");
  expect(
    host
      .querySelector("#grupo-de-ajustes-pagamentos [data-conteudo-grupo]")
      ?.hasAttribute("hidden"),
  ).toBe(false);
  expect(estado.ler).toHaveBeenCalledTimes(2);
  expect(estado.salvar).not.toHaveBeenCalled();
  await clicar("Cartão de crédito pelo app");
  expect(resumo().textContent).toContain("Débito ligado");
  expect(resumo().textContent).toContain("à vista");
  expect(estado.salvar).toHaveBeenCalledWith({
    credito: false,
    debito: true,
    parcelasMax: 12,
  });
  expect(estado.ler).toHaveBeenCalledTimes(2);
});

it("falha de leitura não vira cartão desligado", async () => {
  estado.ler.mockResolvedValue({ ok: false });
  await montar();
  expect(resumo().textContent).toContain("Não foi possível consultar");
  expect(resumo().textContent).not.toContain("Cartão desligado");
});

it("sem liberação pelo app, informa indisponibilidade mesmo com cartão configurado", async () => {
  estado.ligado = false;
  estado.entrega = [];
  await montar();
  expect(resumo().textContent).toContain("Cartão indisponível");
  expect(resumo().textContent).toContain("Libere o pagamento pelo app");
  expect(resumo().textContent).toContain("Nenhuma forma ligada");
});

it("com chave ausente não apresenta cartão como disponível", async () => {
  estado.chave = "";
  await montar();
  expect(resumo().textContent).toContain("Chave ausente");
  expect(resumo().textContent).toContain("Cartão indisponível");
});

it("durante a carga não inventa recebimentos; offline continua explícito", async () => {
  estado.loaded = false;
  estado.offline = true;
  await montar();
  expect(resumo()).toBeNull();
  expect(host.textContent).toContain("Carregando ajustes");
  expect(host.textContent).toContain("Você está offline");
  expect(estado.ler).not.toHaveBeenCalled();
});

it("reabrir Formas renova a leitura existente e recupera falha inicial", async () => {
  estado.ler.mockResolvedValueOnce({ ok: false });
  await montar();
  expect(resumo().textContent).toContain("Não foi possível consultar");
  await clicar("Gerenciar recebimentos");
  expect(resumo().textContent).toContain("Crédito e débito · até 12x");
  expect(estado.ler).toHaveBeenCalledTimes(2);
  const formas = [
    ...host.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
  ].find((el) => el.textContent?.includes("Formas de pagamento"))!;
  await act(async () => formas.click());
  estado.ler.mockResolvedValue({
    ok: true,
    config: { credito: true, debito: false, parcelasMax: 6 },
  });
  await act(async () => formas.click());
  expect(estado.ler).toHaveBeenCalledTimes(3);
  expect(resumo().textContent).toContain("Cartão · Crédito ligado");
  expect(resumo().textContent).toContain("Débito desligado · até 6x");
});

it("o cabeçalho de cada grupo liga o subtítulo ao botão para o leitor de tela", async () => {
  await montar();
  const cabecalhos = [...host.querySelectorAll("button[data-cabecalho-grupo]")];
  const comSubtitulo = cabecalhos.filter((b) =>
    b.querySelector("[data-grupo-subtitulo]"),
  );
  expect(comSubtitulo.length).toBeGreaterThan(0);
  for (const botaoDoGrupo of comSubtitulo) {
    const id = botaoDoGrupo.querySelector("[data-grupo-subtitulo]")!.id;
    expect(id).not.toBe("");
    expect(botaoDoGrupo.getAttribute("aria-describedby")).toContain(id);
  }
});
