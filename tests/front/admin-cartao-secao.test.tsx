// @vitest-environment jsdom
//
// Plano docs/superpowers/plans/2026-09-30-cartao-de-credito-e-debito.md, T6.
// O card "Cartão de crédito e débito" da tela de Ajustes. O que ESTE arquivo
// prova:
//   C1  sem linha salva, a tela mostra o padrão do dono (crédito e débito
//       ligados, parcelas até o máximo do Mercado Pago) e NÃO acusa mudança;
//   C2  salvar grava em `app_settings` a linha 'pagamentos_cartao' no formato
//       do parser único — o mesmo que o checkout e a criar-pagamento leem;
//   C3  falha de LEITURA trava o formulário (salvar por cima de um valor que
//       não se viu apagaria a escolha salva) e oferece "Tentar de novo";
//   C4  valor salvo ilegível avisa e deixa salvar sem mudança — salvar é o
//       conserto.
//
// Mesmo padrão de mercado-pago-secao-salva-e-testa.test.tsx: createRoot +
// act do React puro, dependências de fora mockadas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { banco } = vi.hoisted(() => ({
  banco: {
    linha: null as { value: string } | null,
    erroLeitura: null as unknown,
    upserts: [] as Array<{ linha: Record<string, unknown>; opcoes: unknown }>,
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "app_settings") throw new Error(`tabela ${tabela}`);
      return {
        select: () => ({
          eq: (coluna: string, valor: string) => ({
            maybeSingle: async () => {
              if (coluna !== "key" || valor !== "pagamentos_cartao") {
                throw new Error("consulta errada");
              }
              return { data: banco.linha, error: banco.erroLeitura };
            },
          }),
        }),
        upsert: async (linha: Record<string, unknown>, opcoes: unknown) => {
          banco.upserts.push({ linha, opcoes });
          banco.linha = { value: linha.value as string };
          return { error: null };
        },
      };
    },
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { CartaoSection } from "@/components/admin/settings/CartaoSection";

function botaoPorTexto(texto: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
}

async function assentar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

describe("CartaoSection", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let sujo: boolean[];

  async function montar() {
    await act(async () => {
      raiz.render(<CartaoSection onDirtyMudou={(d) => sujo.push(d)} />);
    });
    await assentar();
  }

  beforeEach(() => {
    banco.linha = null;
    banco.erroLeitura = null;
    banco.upserts = [];
    sujo = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("C1: sem linha salva mostra o padrão do dono e não acusa mudança", async () => {
    await montar();

    const caixas = hospedeiro.querySelectorAll<HTMLInputElement>(
      "input[type='checkbox']",
    );
    expect([...caixas].map((c) => c.checked)).toEqual([true, true]);
    const select = hospedeiro.querySelector<HTMLSelectElement>(
      "#cartao-parcelas-max",
    )!;
    expect(select.value).toBe("");
    expect(select.selectedOptions[0].textContent).toBe(
      "O máximo que o Mercado Pago oferecer",
    );
    expect(sujo.at(-1)).toBe(false);
    expect(botaoPorTexto("Salvar")!.disabled).toBe(true);
    // O card diz onde fica o "sem juros" — não promete fazer daqui.
    expect(hospedeiro.textContent).toContain("Oferecer parcelas sem acréscimo");
  });

  it("C2: desligar o débito e limitar a 6x grava a linha no formato do parser único", async () => {
    await montar();

    const [, debito] = hospedeiro.querySelectorAll<HTMLInputElement>(
      "input[type='checkbox']",
    );
    await act(async () => {
      debito.click();
    });
    const select = hospedeiro.querySelector<HTMLSelectElement>(
      "#cartao-parcelas-max",
    )!;
    await act(async () => {
      select.value = "6";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(sujo.at(-1)).toBe(true);

    await act(async () => {
      botaoPorTexto("Salvar")!.click();
    });
    await assentar();

    expect(banco.upserts).toHaveLength(1);
    expect(banco.upserts[0].linha.key).toBe("pagamentos_cartao");
    expect(JSON.parse(banco.upserts[0].linha.value as string)).toEqual({
      credito: true,
      debito: false,
      parcelas_max: 6,
    });
    expect(banco.upserts[0].opcoes).toEqual({ onConflict: "key" });
    expect(toastSuccess).toHaveBeenCalled();
    expect(sujo.at(-1)).toBe(false);
  });

  it("C3: falha de leitura trava o formulário e oferece 'Tentar de novo'", async () => {
    banco.erroLeitura = { message: "permission denied" };
    await montar();

    expect(hospedeiro.querySelector("[role='alert']")?.textContent).toContain(
      "Não consegui ler",
    );
    const fieldset = hospedeiro.querySelector("fieldset")!;
    expect(fieldset.disabled).toBe(true);
    expect(botaoPorTexto("Salvar")!.disabled).toBe(true);

    banco.erroLeitura = null;
    banco.linha = {
      value: '{"credito":false,"debito":true,"parcelas_max":null}',
    };
    await act(async () => {
      botaoPorTexto("Tentar de novo")!.click();
    });
    await assentar();

    expect(hospedeiro.querySelector("[role='alert']")).toBeNull();
    const caixas = hospedeiro.querySelectorAll<HTMLInputElement>(
      "input[type='checkbox']",
    );
    expect([...caixas].map((c) => c.checked)).toEqual([false, true]);
  });

  it("C4: valor salvo ilegível avisa e deixa salvar sem mudança", async () => {
    banco.linha = { value: "{lixo" };
    await montar();

    expect(hospedeiro.querySelector("[role='alert']")?.textContent).toContain(
      "ilegível",
    );
    const salvar = botaoPorTexto("Salvar")!;
    expect(salvar.disabled).toBe(false);

    await act(async () => {
      salvar.click();
    });
    await assentar();

    expect(JSON.parse(banco.upserts[0].linha.value as string)).toEqual({
      credito: true,
      debito: true,
      parcelas_max: null,
    });
  });
});
