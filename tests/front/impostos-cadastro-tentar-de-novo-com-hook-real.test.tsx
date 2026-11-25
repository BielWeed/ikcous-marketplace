// @vitest-environment jsdom
//
// "Tentar de novo" na leitura do dono, com o hook REAL `useDonoDaLoja` (só o banco
// é falso). O outro arquivo de teste do cartão usa um `useDonoDaLoja` falso, e com
// ele nada prova que o botão funciona de verdade: o hook real guarda a resposta da
// sessão e só lê quando o componente NASCE, então o cartão precisa ser remontado
// (nova `key`) além de esquecer o que o hook guardou. Sem a remontagem a tela fica
// presa em "Não deu para confirmar" para sempre, e o teste com hook falso continua
// verde. Aqui a primeira leitura falha, a segunda responde "sou o dono", e o botão
// "Alterar" precisa destravar.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LeituraDoCadastroFiscal } from "@/lib/fiscal/cadastro";

const EU = "uid-eu";

const { leiturasDoDono, lerDono } = vi.hoisted(() => ({
  /** As respostas que o banco dá a cada leitura de `dono_da_loja`, em ordem. */
  leiturasDoDono: {
    fila: [] as Array<{
      data: { user_id: string } | null;
      error: { code?: string; message: string } | null;
    }>,
  },
  lerDono: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "uid-eu" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeLegalDocument: null } }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: (tabela: string) => {
      if (tabela === "dono_da_loja") {
        return {
          select: () => ({
            maybeSingle: async () => {
              lerDono();
              const resposta = leiturasDoDono.fila.shift();
              if (!resposta) throw new Error("leitura do dono sem resposta");
              return resposta;
            },
          }),
        };
      }
      if (tabela === "fiscal_cadastro_log") {
        return {
          select: () => ({
            order: () => ({
              order: () => ({
                limit: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`leitura inesperada: ${tabela}`);
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { CadastroFiscal } from "@/components/admin/financeiro/impostos/CadastroFiscal";
import { limparDonoDaLoja } from "@/hooks/useDonoDaLoja";

const CADASTRO: LeituraDoCadastroFiscal = {
  estado: "com_cadastro",
  cadastro: {
    regime: "simples",
    atividade: "comercio",
    abertaEm: null,
    vendeNoAppDesde: null,
    atualizadoEm: "2026-11-20T15:30:00Z",
    atualizadoPor: EU,
  },
};

let raiz: Root;
let hospedeiro: HTMLDivElement;

async function assentar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}
function botao(rotulo: string): HTMLButtonElement {
  const achado = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(rotulo),
  );
  if (!achado) throw new Error(`Botão "${rotulo}" não está na tela.`);
  return achado;
}
const temBotao = (rotulo: string) =>
  [...document.querySelectorAll("button")].some((b) =>
    b.textContent?.includes(rotulo),
  );
const travado = (el: HTMLElement) =>
  el.getAttribute("aria-disabled") === "true";

async function montar() {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(
      <CadastroFiscal
        consulta={{
          dados: CADASTRO,
          carregando: false,
          erro: null,
          recarregar: vi.fn(),
        }}
        ativo
        versao={0}
        hoje="2026-11-24"
        aoIrParaMinhaLoja={vi.fn()}
      />,
    );
  });
  await assentar();
}

beforeEach(() => {
  // O hook guarda a resposta da sessão no módulo: cada teste começa do zero.
  limparDonoDaLoja();
  lerDono.mockReset();
  leiturasDoDono.fila = [];
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  limparDonoDaLoja();
});

describe("Cadastro fiscal: 'Tentar de novo' com o hook real do dono", () => {
  it.each([
    ["rede que caiu (não fica guardada)", { message: "Failed to fetch" }],
    [
      "leitura negada (fica guardada na sessão)",
      { code: "42501", message: "negado" },
    ],
  ])(
    "primeira leitura falha (%s), a segunda diz 'sou o dono': o botão destrava",
    async (_nome, falha) => {
      leiturasDoDono.fila = [
        { data: null, error: falha },
        { data: { user_id: EU }, error: null },
      ];
      await montar();

      // Leitura falhou: só leitura, frase neutra e o botão de reler.
      expect(document.body.textContent).toContain(
        "Não deu para confirmar quem pode alterar.",
      );
      expect(travado(botao("Alterar"))).toBe(true);
      expect(lerDono).toHaveBeenCalledTimes(1);

      await act(async () => {
        botao("Tentar de novo").click();
      });
      await assentar();

      // A leitura aconteceu DE VERDADE outra vez, e a resposta nova vale.
      expect(lerDono).toHaveBeenCalledTimes(2);
      expect(document.body.textContent).not.toContain(
        "Não deu para confirmar quem pode alterar.",
      );
      expect(temBotao("Tentar de novo")).toBe(false);
      expect(travado(botao("Alterar"))).toBe(false);
    },
  );

  it("a segunda leitura também falha: segue travado e nada libera na dúvida", async () => {
    leiturasDoDono.fila = [
      { data: null, error: { message: "Failed to fetch" } },
      { data: null, error: { message: "Failed to fetch" } },
    ];
    await montar();
    await act(async () => {
      botao("Tentar de novo").click();
    });
    await assentar();
    expect(lerDono).toHaveBeenCalledTimes(2);
    expect(travado(botao("Alterar"))).toBe(true);
    expect(document.body.textContent).toContain(
      "Não deu para confirmar quem pode alterar.",
    );
  });
});
