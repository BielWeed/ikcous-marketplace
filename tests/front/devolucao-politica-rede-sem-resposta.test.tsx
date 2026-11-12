// @vitest-environment jsdom
//
// Política de trocas e devoluções no painel, rede "pendurada" (conecta e não
// responde): `salvar` chamava a RPC sem prazo e o formulário inteiro ficava
// travado em "salvando" para sempre. Agora o estouro solta o formulário, avisa
// que NÃO se sabe se salvou e mantém o que a lojista digitou. Só a rede é
// dublada; a tela é a de verdade.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, maybeSingle, toast } = vi.hoisted(() => ({
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  },
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "c-1", name: "Calçados" }],
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeAddress: "Rua das Flores, 100 — Centro" },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINHA = {
  id: 1,
  prazo_arrependimento_dias: 7,
  prazo_troca_dias: 30,
  prazo_vicio_dias: 90,
  aceita_troca: true,
  aceita_vale: true,
  exige_fotos_vicio: true,
  metodos_locais: ["entrega_na_loja", "coleta"],
  metodos_nacionais: ["etiqueta_reversa", "envio_proprio"],
  reembolso_momento: "ao_receber",
  frete_troca_pago_por: "cliente",
  categorias_sem_troca: [],
  texto_politica: null,
  endereco_devolucao: null,
  updated_at: "2026-09-26T10:00:00Z",
  updated_by: null,
};

type Resposta = { data: unknown; error: unknown };
let raiz: Root;
let hospedeiro: HTMLDivElement;
const aoMudarSujo = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  maybeSingle.mockResolvedValue({ data: LINHA, error: null });
  rpc.mockImplementation(
    (_nome: string, args: { p: Record<string, unknown> }) =>
      Promise.resolve({ data: { ...LINHA, ...args.p }, error: null }),
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

async function esvaziarFila() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}
async function montar() {
  const { PoliticaDeDevolucaoSection } = await import(
    "@/components/admin/settings/PoliticaDeDevolucaoSection"
  );
  await act(async () => {
    raiz.render(<PoliticaDeDevolucaoSection onDirtyMudou={aoMudarSujo} />);
  });
  await esvaziarFila();
}
async function digitar(id: string, valor: string) {
  const campo = hospedeiro.querySelector<HTMLInputElement>(`#${id}`);
  expect(campo).toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    campo?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    setter?.call(campo, valor);
    campo?.dispatchEvent(new Event("input", { bubbles: true }));
    campo?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}
const botaoDeSalvar = () =>
  Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    /Salvar política|Política salva/.test(b.textContent ?? ""),
  ) as HTMLButtonElement;
const formulario = () =>
  hospedeiro.querySelector(
    '[data-testid="politica-devolucao"]',
  ) as HTMLFieldSetElement;
const campo = (id: string) =>
  hospedeiro.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;

async function clicarEmSalvar() {
  await act(async () => {
    botaoDeSalvar().click();
  });
}
async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("política de devolução com rede conectada e sem resposta", () => {
  it("solta o formulário, avisa que não se sabe se salvou e mantém o que foi digitado", async () => {
    await montar();
    await digitar("politica-troca", "45");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    rpc.mockImplementationOnce(() => new Promise<Resposta>(() => {}));

    await clicarEmSalvar();
    expect(formulario().disabled).toBe(true);

    await avancar(20_000);

    expect(formulario().disabled).toBe(false);
    expect(toast.warning).toHaveBeenCalledTimes(1);
    const aviso = String(toast.warning.mock.calls[0][0]);
    expect(aviso).toContain("Sem resposta da rede");
    expect(aviso).toContain("Não dá para saber se a política foi salva");
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    // O que ela digitou continua na tela e continua por salvar.
    expect(campo("politica-troca").value).toBe("45");
    expect(botaoDeSalvar().textContent).toContain("Salvar política");
  });

  it("a resposta que chega depois do prazo não vira aviso de sucesso nem troca o formulário", async () => {
    await montar();
    await digitar("politica-troca", "45");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let resolver!: (r: Resposta) => void;
    rpc.mockImplementationOnce(
      () => new Promise<Resposta>((resolve) => (resolver = resolve)),
    );
    await clicarEmSalvar();
    await avancar(20_000);
    expect(toast.warning).toHaveBeenCalledTimes(1);

    await act(async () =>
      resolver({ data: { ...LINHA, prazo_troca_dias: 45 }, error: null }),
    );

    expect(toast.success).not.toHaveBeenCalled();
    expect(campo("politica-troca").value).toBe("45");
    expect(botaoDeSalvar().textContent).toContain("Salvar política");
  });

  it("salvar de novo depois do estouro funciona e confirma", async () => {
    await montar();
    await digitar("politica-troca", "45");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    rpc.mockImplementationOnce(() => new Promise<Resposta>(() => {}));
    await clicarEmSalvar();
    await avancar(20_000);
    expect(formulario().disabled).toBe(false);

    await clicarEmSalvar();
    await avancar(0);

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(botaoDeSalvar().textContent).toContain("Política salva");
  });

  it("a RPC que responde dentro do prazo continua salvando como antes", async () => {
    await montar();
    await digitar("politica-troca", "45");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    await clicarEmSalvar();
    await avancar(0);

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(formulario().disabled).toBe(false);
  });
});
