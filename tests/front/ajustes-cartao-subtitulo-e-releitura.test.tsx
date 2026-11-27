// @vitest-environment jsdom
// O subtítulo do grupo Pagamentos na TELA recebe o estado do cartão pelo app
// (antes só a função pura `subtitulosDosGrupos` era provada), e a releitura do
// cartão (reabrir "Formas de pagamento", voltar à aba Ajustes) não pisca: o
// aviso "Ao ligar, o cartão…" e o "+ cartão" do subtítulo seguem o último
// estado CONFIRMADO enquanto a nova leitura não volta.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  ligado: true,
  chave: "APP_USR-exemplo",
  entrega: ["cash"],
  ler: vi.fn(),
  salvar: vi.fn(),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { formasPagamentoEntrega: estado.entrega },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
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

const AVISO = "Ao ligar, o cartão";
const CREDITO_LIGADO = {
  ok: true,
  config: { credito: true, debito: false, parcelasMax: 6 },
} as const;

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  estado.ligado = true;
  estado.chave = "APP_USR-exemplo";
  estado.entrega = ["cash"];
  estado.ler.mockReset().mockResolvedValue(CREDITO_LIGADO);
  estado.salvar.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function montar(active?: boolean) {
  await act(async () =>
    root.render(<AdminSettingsView onNavigate={vi.fn()} active={active} />),
  );
}
async function clicar(label: string) {
  const botao = host.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  expect(botao, label).not.toBeNull();
  await act(async () => botao!.click());
}
const subtituloDePagamentos = () =>
  host.querySelector("#grupo-de-ajustes-pagamentos [data-grupo-subtitulo]")
    ?.textContent;
const secaoDeFormas = () =>
  [...host.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find(
    (el) => el.textContent?.includes("Formas de pagamento"),
  )!;
function leituraPendente() {
  let resolver!: (valor: unknown) => void;
  estado.ler.mockReturnValueOnce(
    new Promise((resolve) => {
      resolver = resolve;
    }),
  );
  return (valor: unknown) => act(async () => resolver(valor));
}

it("(a) com o cartão lido ligado, o subtítulo de Pagamentos diz '+ cartão'", async () => {
  await montar();
  expect(estado.ler).toHaveBeenCalledTimes(1);
  expect(subtituloDePagamentos()).toBe("Na entrega + PIX + cartão");
});

it.each([
  ["falha", () => estado.ler.mockResolvedValue({ ok: false })],
  [
    "não resolve",
    () => estado.ler.mockReturnValue(new Promise(() => undefined)),
  ],
])(
  "(b) leitura do cartão que %s não acrescenta cartão ao subtítulo",
  async (_nome, preparar) => {
    preparar();
    await montar();
    expect(subtituloDePagamentos()).toBe("Na entrega + PIX");
  },
);

it("(c) reabrir com o cartão confirmado ligado não pisca o aviso nem o subtítulo", async () => {
  await montar();
  expect(subtituloDePagamentos()).toBe("Na entrega + PIX + cartão");

  // A abertura dispara a releitura, que fica pendente.
  const resolver = leituraPendente();
  await clicar("Gerenciar recebimentos");
  expect(estado.ler).toHaveBeenCalledTimes(2);
  expect(secaoDeFormas().getAttribute("aria-expanded")).toBe("true");
  expect(host.textContent).not.toContain(AVISO);
  expect(subtituloDePagamentos()).toBe("Na entrega + PIX + cartão");

  await resolver(CREDITO_LIGADO);
  expect(host.textContent).not.toContain(AVISO);
  expect(subtituloDePagamentos()).toBe("Na entrega + PIX + cartão");

  // Fechar e reabrir: mais uma releitura pendente, de novo sem piscar.
  await act(async () => secaoDeFormas().click());
  const resolverDeNovo = leituraPendente();
  await act(async () => secaoDeFormas().click());
  expect(estado.ler).toHaveBeenCalledTimes(3);
  expect(host.textContent).not.toContain(AVISO);
  expect(subtituloDePagamentos()).toBe("Na entrega + PIX + cartão");
  await resolverDeNovo(CREDITO_LIGADO);
  expect(host.textContent).not.toContain(AVISO);
});

it("(c) releitura que falha depois de uma confirmação mantém o último confirmado", async () => {
  await montar();
  estado.ler.mockResolvedValueOnce({ ok: false });
  await clicar("Gerenciar recebimentos");
  expect(estado.ler).toHaveBeenCalledTimes(2);
  expect(host.textContent).not.toContain(AVISO);
  expect(subtituloDePagamentos()).toBe("Na entrega + PIX + cartão");
});

it("(c) releitura que confirma crédito e débito desligados mostra o aviso e tira o cartão", async () => {
  await montar();
  estado.ler.mockResolvedValueOnce({
    ok: true,
    config: { credito: false, debito: false, parcelasMax: 1 },
  });
  await clicar("Gerenciar recebimentos");
  expect(host.textContent).toContain(AVISO);
  expect(subtituloDePagamentos()).toBe("Na entrega + PIX");
});

it("(d) a aba Ajustes volta a ficar ativa e relê o cartão, sem ler duas vezes ao montar", async () => {
  await montar(true);
  expect(estado.ler).toHaveBeenCalledTimes(1);

  // Outro aparelho desligou o cartão enquanto a aba estava escondida.
  estado.ler.mockResolvedValue({
    ok: true,
    config: { credito: false, debito: false, parcelasMax: 1 },
  });
  await montar(false);
  expect(estado.ler).toHaveBeenCalledTimes(1);
  await montar(true);
  expect(estado.ler).toHaveBeenCalledTimes(2);
  expect(subtituloDePagamentos()).toBe("Na entrega + PIX");
});
