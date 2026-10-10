// @vitest-environment jsdom
//
// D8 do painel simples: "Mesmo endereço da loja" na política de devolução.
// A semântica é a de sempre — `endereco_devolucao` vazio = usa o endereço da
// loja (`config.storeAddress`). Só ficou visível: vazio → a caixa vem marcada
// mostrando o endereço, sem campo; desmarcar mostra o campo; remarcar e salvar
// envia `endereco_devolucao: ""`. O payload da RPC `salvar_politica_de_devolucao`
// NÃO muda: os três casos (marcada / desmarcada com valor / desmarcada vazia)
// mandam o mesmo que o campo de texto mandava antes.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, maybeSingle, toast, loja } = vi.hoisted(() => ({
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
  loja: { storeAddress: "Rua das Flores, 100 — Centro" as string | null },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  },
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeAddress: loja.storeAddress },
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
  endereco_devolucao: null as string | null,
  updated_at: "2026-09-26T10:00:00Z",
  updated_by: null,
};

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  loja.storeAddress = "Rua das Flores, 100 — Centro";
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
});

async function esperar() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

async function montar() {
  const { PoliticaDeDevolucaoSection } = await import(
    "@/components/admin/settings/PoliticaDeDevolucaoSection"
  );
  await act(async () => {
    raiz.render(<PoliticaDeDevolucaoSection />);
  });
  await esperar();
}

function caixa(): HTMLInputElement {
  const achada = Array.from(
    hospedeiro.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ).find((c) => c.labels?.[0]?.textContent?.includes("Mesmo endereço da loja"));
  if (!achada) throw new Error("caixa 'Mesmo endereço da loja' não apareceu");
  return achada;
}

const campo = () =>
  hospedeiro.querySelector<HTMLInputElement>("#politica-endereco");

async function clicar(el: HTMLElement | undefined | null) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.click();
  });
}

async function digitar(id: string, valor: string) {
  const alvo = hospedeiro.querySelector<HTMLInputElement>(`#${id}`);
  expect(alvo).toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    alvo?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    setter?.call(alvo, valor);
    alvo?.dispatchEvent(new Event("input", { bubbles: true }));
    alvo?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

function botao(texto: string) {
  return Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  );
}

async function salvar() {
  await clicar(botao("Salvar política"));
  await esperar();
}

/** O `endereco_devolucao` que foi para a RPC na última chamada. */
function enderecoEnviado(): unknown {
  expect(rpc).toHaveBeenCalledWith(
    "salvar_politica_de_devolucao",
    expect.anything(),
  );
  const [, args] = rpc.mock.calls.at(-1) as [
    string,
    { p: Record<string, unknown> },
  ];
  return args.p.endereco_devolucao;
}

describe("Mesmo endereço da loja (D8)", () => {
  it("vazio: a caixa vem marcada mostrando o endereço da loja, sem campo", async () => {
    await montar();
    expect(caixa().checked).toBe(true);
    expect(hospedeiro.textContent).toContain("Rua das Flores, 100 — Centro");
    expect(campo()).toBeNull();
    expect(botao("Política salva")?.disabled).toBe(true);
  });

  it("desmarcar mostra o campo, vazio, e não suja o formulário", async () => {
    await montar();
    await clicar(caixa());
    expect(caixa().checked).toBe(false);
    expect(campo()).toBeTruthy();
    expect(campo()?.value).toBe("");
    expect(hospedeiro.textContent).not.toContain(
      "Rua das Flores, 100 — Centro",
    );
    expect(botao("Política salva")?.disabled).toBe(true);
  });

  it("desmarcada com valor: envia o endereço digitado", async () => {
    await montar();
    await clicar(caixa());
    await digitar("politica-endereco", "Galpão, Rua B 50");
    await salvar();
    expect(enderecoEnviado()).toBe("Galpão, Rua B 50");
  });

  it("desmarcada e vazia: envia vazio (o endereço da loja, como hoje)", async () => {
    await montar();
    await clicar(caixa());
    await digitar("politica-troca", "15");
    await salvar();
    expect(enderecoEnviado()).toBe("");
  });

  it("marcada sem mexer: envia vazio", async () => {
    await montar();
    await digitar("politica-troca", "15");
    await salvar();
    expect(enderecoEnviado()).toBe("");
  });

  it("endereço próprio salvo: vem desmarcada com o campo; remarcar e salvar envia vazio", async () => {
    maybeSingle.mockResolvedValue({
      data: { ...LINHA, endereco_devolucao: "Galpão, Rua B 50" },
      error: null,
    });
    await montar();
    expect(caixa().checked).toBe(false);
    expect(campo()?.value).toBe("Galpão, Rua B 50");

    await clicar(caixa());
    expect(caixa().checked).toBe(true);
    expect(campo()).toBeNull();
    expect(hospedeiro.textContent).toContain("Rua das Flores, 100 — Centro");

    await salvar();
    expect(enderecoEnviado()).toBe("");
  });

  it("desmarcar de novo devolve o endereço que estava, sem sujar", async () => {
    maybeSingle.mockResolvedValue({
      data: { ...LINHA, endereco_devolucao: "Galpão, Rua B 50" },
      error: null,
    });
    await montar();
    await clicar(caixa());
    expect(botao("Salvar política")).toBeTruthy();
    await clicar(caixa());
    expect(campo()?.value).toBe("Galpão, Rua B 50");
    expect(botao("Política salva")?.disabled).toBe(true);
  });

  it("loja sem endereço cadastrado: a caixa avisa onde cadastrar", async () => {
    loja.storeAddress = null;
    await montar();
    expect(caixa().checked).toBe(true);
    expect(hospedeiro.textContent).toContain("Minha loja");
  });
});
