// @vitest-environment jsdom
//
// Financeiro, pela tela inteira — conta e categoria NOVAS:
//  - com o salvamento no ar a folha não fecha (X, Esc), como já vale para
//    lançamento, caixa e baixa; fechar e reabrir deixaria salvar de novo;
//  - se a resposta se perde por queda de rede (erro sem código), o Salvar fica
//    parado e, ao fechar, a tela relê a lista para a conferência não olhar
//    dado velho.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/admin/financeiro/FluxoDeCaixaGrafico", () => ({
  FluxoDeCaixaGrafico: () => null,
}));

import { AdminFinanceiroView } from "@/views/admin/AdminFinanceiroView";

const LEITURAS = new Set(["fin_contas_listar", "fin_categorias_listar"]);
const REDE_CAIU = { message: "TypeError: Failed to fetch", code: "" };

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ");
const folha = () =>
  document.querySelector<HTMLElement>('[data-slot="sheet-content"]');

function botaoEm(raiz: ParentNode, rotulo: string): HTMLButtonElement {
  const el = [...raiz.querySelectorAll("button")].find(
    (b) => normalizar(b.textContent).trim() === rotulo,
  );
  if (!el) throw new Error(`botão "${rotulo}" não existe`);
  return el as HTMLButtonElement;
}
const botaoX = (raiz: ParentNode) =>
  raiz.querySelector<HTMLButtonElement>('[aria-label="Fechar"]');

async function esperar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}
async function clicar(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await esperar();
}
async function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    el.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}
async function apertarEsc(painel: HTMLElement) {
  await act(async () => {
    painel.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  await esperar();
}

const CASOS = [
  {
    nome: "conta",
    abrir: "Nova conta",
    campo: "fin-conta-nome",
    rpc: "fin_conta_salvar",
    lista: "fin_contas_listar",
  },
  {
    nome: "categoria",
    abrir: "Nova categoria",
    campo: "fin-categoria-nome",
    rpc: "fin_categoria_salvar",
    lista: "fin_categorias_listar",
  },
] as const;

describe.each(CASOS)("Financeiro — $nome nova na tela inteira", (c) => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let soltar: (resposta: { data: unknown; error: unknown }) => void;

  const chamadasDa = (rpc: string) =>
    rpcFalso.mock.calls.filter(([nome]) => nome === rpc).length;

  beforeEach(async () => {
    rpcFalso.mockReset();
    rpcFalso.mockImplementation(async (nome: string) => {
      if (nome === c.rpc) {
        return new Promise((resolve) => {
          soltar = resolve;
        });
      }
      return { data: LEITURAS.has(nome) ? [] : null, error: null };
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<AdminFinanceiroView onNavigate={vi.fn()} active />);
    });
    await esperar();
    await clicar(botaoEm(hospedeiro, "Contas"));
    await clicar(botaoEm(hospedeiro, c.abrir));
    await digitar(c.campo, "Cofre do fundo");
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("não fecha com o salvamento no ar (X e Esc) e fecha quando o servidor grava", async () => {
    const painel = folha() as HTMLElement;
    await clicar(botaoEm(painel, "Salvar"));
    expect(chamadasDa(c.rpc)).toBe(1);

    expect(botaoX(painel)?.disabled).toBe(true);
    await clicar(botaoX(painel) as HTMLElement);
    await apertarEsc(painel);
    // Nem a pergunta "Descartar?" abre: descartar fecharia a folha com a
    // gravação ainda no ar, e abrir outra deixaria salvar de novo.
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(folha()).toBe(painel);

    await act(async () => soltar({ data: null, error: null }));
    await esperar();
    expect(folha()).toBeNull();
    expect(chamadasDa(c.rpc)).toBe(1);
  });

  it("controle: recusa do servidor com a folha ainda aberta destrava o X e deixa repetir", async () => {
    const painel = folha() as HTMLElement;
    await clicar(botaoEm(painel, "Salvar"));
    await act(async () =>
      soltar({
        data: null,
        error: { code: "22023", message: "Nome já usado.", details: null },
      }),
    );
    await esperar();
    expect(folha()).toBe(painel);
    expect(botaoX(painel)?.disabled).toBe(false);
    expect(normalizar(painel.textContent)).toContain("Nome já usado.");
    expect(botaoEm(painel, "Salvar").disabled).toBe(false);
  });

  it("queda de rede: Salvar parado, e ao fechar a tela relê a lista (sem 2º cadastro)", async () => {
    const painel = folha() as HTMLElement;
    const leiturasAntes = chamadasDa(c.lista);
    await clicar(botaoEm(painel, "Salvar"));
    await act(async () => soltar({ data: null, error: REDE_CAIU }));
    await esperar();

    expect(normalizar(painel.textContent)).toMatch(/não deu para confirmar/);
    expect(botaoEm(painel, "Salvar").disabled).toBe(true);
    await clicar(botaoEm(painel, "Salvar"));
    expect(chamadasDa(c.rpc)).toBe(1);

    // Agora o X obedece (o envio acabou); algo foi digitado, então pergunta.
    await clicar(botaoX(painel) as HTMLElement);
    const pergunta = document.querySelector<HTMLElement>(
      '[role="alertdialog"]',
    );
    await clicar(botaoEm(pergunta as HTMLElement, "Descartar"));
    expect(folha()).toBeNull();
    expect(chamadasDa(c.lista)).toBeGreaterThan(leiturasAntes);
    expect(chamadasDa(c.rpc)).toBe(1);
  });
});
