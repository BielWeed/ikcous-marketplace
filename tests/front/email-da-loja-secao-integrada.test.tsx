// @vitest-environment jsdom
//
// A seção "E-mail da loja" com o HOOK DE VERDADE e só a edge dublada
// (14/10/2026). Aqui moram as provas que dependem da cola entre tela e
// servidor:
//   I1  a senha vai para o servidor UMA vez e não aparece em lugar nenhum da
//       tela depois — nem quando o servidor, por defeito, devolve o campo;
//   I2  texto cru do servidor (até com a senha dentro) nunca chega à tela;
//   I3  função ausente (404): a tela diz "ainda não disponível" sem quebrar.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeFalso } = vi.hoisted(() => ({ invokeFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeFalso } },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { EmailDaLojaSection } from "@/components/admin/settings/EmailDaLojaSection";

const SENHA = "abcdefghijklmnop";
const STATUS_VAZIO = {
  usuario: null,
  senha_guardada: false,
  ultimo_teste: null,
  origem: "nenhuma",
  cofre_pronto: true,
  problema: null,
  saude: null,
};

let raiz: Root;
let hospedeiro: HTMLDivElement;

async function montar() {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(<EmailDaLojaSection />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clicar(rotulo: string) {
  const b = [...hospedeiro.querySelectorAll("button")].find((x) =>
    x.textContent?.includes(rotulo),
  );
  if (!b) throw new Error(`Botão "${rotulo}" não está na tela.`);
  await act(async () => {
    b.click();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
}

async function irParaPasso4() {
  for (let i = 0; i < 3; i++) await clicar("Já fiz, próximo passo");
}

describe("EmailDaLojaSection + useEmailDaLoja", () => {
  beforeEach(() => {
    invokeFalso.mockReset();
    // useOnlineStatus (mock acima) devolve isOffline = false; o navigator.onLine cobre o hook
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });
  afterEach(async () => {
    await act(async () => {
      raiz?.unmount();
    });
    hospedeiro?.remove();
  });

  it("I1 — a senha vai ao servidor uma vez e não sobra na tela, nem se o servidor a devolver por defeito", async () => {
    invokeFalso.mockImplementation(async (_nome: string, { body }: any) => {
      if (body.acao === "status") return { data: STATUS_VAZIO, error: null };
      if (body.acao === "salvar") {
        return {
          data: {
            ...STATUS_VAZIO,
            usuario: "loja@gmail.com",
            senha_guardada: true,
            origem: "painel",
            ultimo_teste: {
              ok: true,
              em: "2026-10-14T12:00:00Z",
              motivo: null,
            },
            // defeito hipotético do servidor: devolver a senha. A tela não pode exibi-la.
            senha: SENHA,
            senha_cifrada: SENHA,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    await montar();
    await irParaPasso4();
    digitar("email-loja-usuario", "loja@gmail.com");
    digitar(
      "email-loja-senha",
      `${SENHA.slice(0, 4)} ${SENHA.slice(4, 8)} ${SENHA.slice(8, 12)} ${SENHA.slice(12)}`,
    );
    await clicar("Salvar");

    const salvar = invokeFalso.mock.calls.filter(
      ([, o]) => (o as any).body.acao === "salvar",
    );
    expect(salvar).toHaveLength(1);
    expect(salvar[0][1]).toEqual({
      body: { acao: "salvar", usuario: "loja@gmail.com", senha: SENHA },
    });

    // depois de salvo: selo "Funcionando", e a senha em lugar nenhum
    expect(
      hospedeiro.querySelector("[data-selo]")?.getAttribute("data-selo"),
    ).toBe("funcionando");
    expect(hospedeiro.textContent).not.toContain(SENHA);
    expect(hospedeiro.innerHTML).not.toContain(SENHA);
    for (const campo of hospedeiro.querySelectorAll("input")) {
      expect(campo.value).not.toContain(SENHA);
    }
  });

  it("I2 — texto cru do servidor (até com a senha dentro) nunca chega à tela", async () => {
    const CRU = `Invalid login: 535 5.7.8 smtp://loja@gmail.com:${SENHA}@smtp.gmail.com`;
    invokeFalso.mockImplementation(async (_nome: string, { body }: any) => {
      if (body.acao === "status") return { data: STATUS_VAZIO, error: null };
      return {
        data: null,
        error: {
          name: "FunctionsHttpError",
          message: "Edge Function returned a non-2xx status code",
          context: new Response(
            JSON.stringify({ erro: CRU, motivo: "senha_errada" }),
            {
              status: 422,
            },
          ),
        },
      };
    });
    await montar();
    await irParaPasso4();
    digitar("email-loja-usuario", "loja@gmail.com");
    digitar("email-loja-senha", SENHA);
    await clicar("Salvar");

    const alerta = hospedeiro.querySelector("[data-resultado][role='alert']");
    expect(alerta?.textContent).toContain("O Google recusou a senha");
    expect(hospedeiro.innerHTML).not.toContain("smtp://");
    expect(hospedeiro.innerHTML).not.toContain("535");
    expect(hospedeiro.textContent).not.toContain(SENHA);
  });

  it("I3 — função ausente (404): 'ainda não disponível nesta loja', sem quebrar", async () => {
    invokeFalso.mockResolvedValue({
      data: null,
      error: {
        name: "FunctionsHttpError",
        message: "Edge Function returned a non-2xx status code",
        context: new Response("not found", { status: 404 }),
      },
    });
    await montar();
    expect(hospedeiro.textContent).toContain(
      "Este recurso ainda não está disponível nesta loja",
    );
    expect(hospedeiro.querySelector("input")).toBeNull();
  });

  it("I4 — queda de rede passageira (internet ligada): frase de conexão e 'Tentar de novo' que funciona; não diz que o recurso não existe", async () => {
    invokeFalso
      .mockResolvedValueOnce({
        data: null,
        error: {
          name: "FunctionsFetchError",
          message: "Failed to send a request to the Edge Function",
          context: new TypeError("Failed to fetch"),
        },
      })
      .mockResolvedValueOnce({ data: STATUS_VAZIO, error: null });
    await montar();
    expect(hospedeiro.textContent).not.toContain("ainda não está disponível");
    expect(hospedeiro.textContent).toContain("tente de novo");
    await clicar("Tentar de novo");
    expect(hospedeiro.querySelector("[data-selo]")).not.toBeNull();
    expect(hospedeiro.textContent).toContain("Passo 1 de 5");
  });
});
