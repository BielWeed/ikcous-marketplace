// @vitest-environment jsdom
//
// O hook que fala com a edge `credenciais-email` (14/10/2026). O que prova:
//   H1  `status` na montagem; resposta vira o estado da tela;
//   H2  404 e erro de rede (com internet) = "indisponível nesta loja";
//       erro de rede SEM internet = "sem conexão"; outro erro = "erro" com
//       botão de tentar de novo — nenhum quebra a tela;
//   H3  `salvar` manda { acao, usuario, senha } e NADA do servidor sobra no
//       estado além do status (a senha nunca é devolvida nem guardada);
//   H4  o texto cru do servidor (campo `erro`) NUNCA chega à mensagem;
//   H5  `testar`: só `ok === true` é sucesso (resposta torta não vira "enviado");
//       o resultado do teste volta a ler o status;
//   H6  `remover` aplica o status devolvido;
//   H7  duas chamadas ao mesmo tempo: a segunda não dispara outra ida ao servidor.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeFalso } = vi.hoisted(() => ({ invokeFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeFalso } },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { type UseEmailDaLoja, useEmailDaLoja } from "@/hooks/useEmailDaLoja";

const STATUS_VAZIO = {
  usuario: null,
  senha_guardada: false,
  ultimo_teste: null,
  atualizado_em: null,
  origem: "nenhuma",
  painel_legivel: false,
  cofre_pronto: true,
  problema: null,
  saude: null,
};
const STATUS_SALVO = {
  ...STATUS_VAZIO,
  usuario: "loja@gmail.com",
  senha_guardada: true,
  origem: "painel",
  painel_legivel: true,
  ultimo_teste: { ok: true, em: "2026-10-14T12:00:00Z", motivo: null },
};

/** Erro de resposta HTTP não-2xx, como o SDK de funções o entrega. */
function erroHttp(status: number, corpo: unknown) {
  return {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: new Response(JSON.stringify(corpo), { status }),
  };
}
const erroDeRede = () => ({
  name: "FunctionsFetchError",
  message: "Failed to send a request to the Edge Function",
  context: new TypeError("Failed to fetch"),
});

let atual: UseEmailDaLoja;
// O hook é lido de DENTRO de um efeito e entregue por callback: reatribuir uma
// variável de fora durante o render é efeito colateral que o React proíbe.
function Sonda({ aoLer }: { aoLer: (valor: UseEmailDaLoja) => void }) {
  const valor = useEmailDaLoja();
  useEffect(() => {
    aoLer(valor);
  });
  return null;
}

let raiz: Root;
async function montar() {
  const hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(
      <Sonda
        aoLer={(valor) => {
          atual = valor;
        }}
      />,
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
}

function acoesChamadas(): string[] {
  return invokeFalso.mock.calls.map(
    ([, opcoes]) => (opcoes as { body: { acao: string } }).body.acao,
  );
}

describe("useEmailDaLoja", () => {
  beforeEach(() => {
    invokeFalso.mockReset();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });
  afterEach(async () => {
    await act(async () => {
      raiz?.unmount();
    });
  });

  it("H1 — lê o status ao montar, pela função credenciais-email", async () => {
    invokeFalso.mockResolvedValue({ data: STATUS_SALVO, error: null });
    await montar();
    expect(invokeFalso).toHaveBeenCalledTimes(1);
    expect(invokeFalso.mock.calls[0][0]).toBe("credenciais-email");
    expect(invokeFalso.mock.calls[0][1]).toEqual({ body: { acao: "status" } });
    expect(atual.carga).toBe("pronto");
    expect(atual.status?.usuario).toBe("loja@gmail.com");
    expect(atual.status?.senhaGuardada).toBe(true);
    expect(atual.status?.origem).toBe("painel");
  });

  it("H2 — 404: indisponível nesta loja", async () => {
    invokeFalso.mockResolvedValue({
      data: null,
      error: erroHttp(404, { erro: "Not found" }),
    });
    await montar();
    expect(atual.carga).toBe("indisponivel");
    expect(atual.mensagemDeCarga).toContain(
      "ainda não está disponível nesta loja",
    );
    expect(atual.status).toBeNull();
  });

  it("H2 — erro de rede COM internet: 'erro' com frase de conexão (dá para tentar de novo), NÃO 'indisponível'", async () => {
    invokeFalso.mockResolvedValue({ data: null, error: erroDeRede() });
    await montar();
    expect(atual.carga).toBe("erro");
    expect(atual.mensagemDeCarga).not.toContain("ainda não está disponível");
    expect(atual.mensagemDeCarga).toContain("tente de novo");
  });

  it("H2 — erro de rede SEM internet: erro de conexão, não 'indisponível'", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    invokeFalso.mockResolvedValue({ data: null, error: erroDeRede() });
    await montar();
    expect(atual.carga).toBe("erro");
    expect(atual.mensagemDeCarga).toContain("Sem conexão");
  });

  it("H2 — erro 500: 'erro' com mensagem da casa, e dá para tentar de novo", async () => {
    invokeFalso
      .mockResolvedValueOnce({
        data: null,
        error: erroHttp(500, { erro: "boom" }),
      })
      .mockResolvedValueOnce({ data: STATUS_SALVO, error: null });
    await montar();
    expect(atual.carga).toBe("erro");
    expect(atual.mensagemDeCarga).not.toContain("boom");
    await act(async () => {
      await atual.recarregar();
    });
    expect(atual.carga).toBe("pronto");
  });

  it("H2 — resposta que nem é objeto: erro, não tela quebrada", async () => {
    invokeFalso.mockResolvedValue({ data: null, error: null });
    await montar();
    expect(atual.carga).toBe("erro");
  });

  it("H3 — salvar manda usuario e senha e fica só com o status devolvido", async () => {
    invokeFalso
      .mockResolvedValueOnce({ data: STATUS_VAZIO, error: null })
      .mockResolvedValueOnce({ data: STATUS_SALVO, error: null });
    await montar();
    let r: Awaited<ReturnType<UseEmailDaLoja["salvar"]>> | undefined;
    await act(async () => {
      r = await atual.salvar("loja@gmail.com", "abcdefghijklmnop");
    });
    expect(r).toEqual({ ok: true });
    expect(invokeFalso.mock.calls[1][1]).toEqual({
      body: {
        acao: "salvar",
        usuario: "loja@gmail.com",
        senha: "abcdefghijklmnop",
      },
    });
    expect(atual.status?.senhaGuardada).toBe(true);
    // nada do que o hook guarda contém a senha
    expect(JSON.stringify(atual)).not.toContain("abcdefghijklmnop");
  });

  it("H4 — 422 do Google: a frase vem do CÓDIGO; o texto cru do servidor não passa", async () => {
    invokeFalso
      .mockResolvedValueOnce({ data: STATUS_VAZIO, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: erroHttp(422, {
          erro: "Invalid login smtp://loja@gmail.com:SEGREDO-NO-ERRO@smtp.gmail.com",
          motivo: "acesso_bloqueado",
        }),
      });
    await montar();
    let r: Awaited<ReturnType<UseEmailDaLoja["salvar"]>> | undefined;
    await act(async () => {
      r = await atual.salvar("loja@gmail.com", "abcdefghijklmnop");
    });
    expect(r?.ok).toBe(false);
    const mensagem = r && !r.ok ? r.mensagem : "";
    expect(mensagem).toContain("Fui eu");
    expect(mensagem).not.toContain("SEGREDO");
    expect(mensagem).not.toContain("smtp");
  });

  it("H4 — 429 carrega o tempo que falta", async () => {
    invokeFalso
      .mockResolvedValueOnce({ data: STATUS_SALVO, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: erroHttp(429, { erro: "Calma", espere_segundos: 125 }),
      });
    await montar();
    let r: Awaited<ReturnType<UseEmailDaLoja["testar"]>> | undefined;
    await act(async () => {
      r = await atual.testar();
    });
    expect(r?.ok).toBe(false);
    expect(r && !r.ok ? r.mensagem : "").toContain("3 minutos");
    // a tela usa o número para segurar o botão de teste
    expect(r && !r.ok ? r.espereSegundos : undefined).toBe(125);
  });

  it("H5 — testar com ok:true é sucesso e relê o status", async () => {
    invokeFalso
      .mockResolvedValueOnce({ data: STATUS_SALVO, error: null })
      .mockResolvedValueOnce({
        data: {
          ok: true,
          motivo: null,
          em: "2026-10-14T13:00:00Z",
          mensagem: "x",
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: STATUS_SALVO, error: null });
    await montar();
    let r: Awaited<ReturnType<UseEmailDaLoja["testar"]>> | undefined;
    await act(async () => {
      r = await atual.testar();
    });
    expect(r).toEqual({ ok: true });
    expect(acoesChamadas()).toEqual(["status", "testar", "status"]);
  });

  it("H5 — testar com ok:false (HTTP 200) é falha, com a frase do motivo", async () => {
    invokeFalso
      .mockResolvedValueOnce({ data: STATUS_SALVO, error: null })
      .mockResolvedValueOnce({
        data: {
          ok: false,
          motivo: "senha_errada",
          em: "2026-10-14T13:00:00Z",
          mensagem: "Invalid login: SEGREDO",
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: STATUS_SALVO, error: null });
    await montar();
    let r: Awaited<ReturnType<UseEmailDaLoja["testar"]>> | undefined;
    await act(async () => {
      r = await atual.testar();
    });
    expect(r?.ok).toBe(false);
    const mensagem = r && !r.ok ? r.mensagem : "";
    expect(mensagem).toContain("recusou a senha");
    expect(mensagem).not.toContain("SEGREDO");
  });

  it("H5 — resposta torta do teste (sem ok:true) NUNCA vira 'enviado'", async () => {
    invokeFalso
      .mockResolvedValueOnce({ data: STATUS_SALVO, error: null })
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: STATUS_SALVO, error: null });
    await montar();
    let r: Awaited<ReturnType<UseEmailDaLoja["testar"]>> | undefined;
    await act(async () => {
      r = await atual.testar();
    });
    expect(r?.ok).toBe(false);
  });

  it("H6 — remover aplica o status devolvido (volta a 'Não configurado')", async () => {
    invokeFalso
      .mockResolvedValueOnce({ data: STATUS_SALVO, error: null })
      .mockResolvedValueOnce({ data: STATUS_VAZIO, error: null });
    await montar();
    await act(async () => {
      await atual.remover();
    });
    expect(invokeFalso.mock.calls[1][1]).toEqual({ body: { acao: "remover" } });
    expect(atual.status?.senhaGuardada).toBe(false);
    expect(atual.status?.origem).toBe("nenhuma");
  });

  it("H7 — duas chamadas ao mesmo tempo: a segunda é recusada sem ir ao servidor", async () => {
    let liberar: (v: unknown) => void = () => {};
    invokeFalso
      .mockResolvedValueOnce({ data: STATUS_VAZIO, error: null })
      .mockImplementationOnce(
        () =>
          new Promise((resolver) => {
            liberar = resolver;
          }),
      );
    await montar();
    let primeira: Promise<unknown> | undefined;
    let segunda: Awaited<ReturnType<UseEmailDaLoja["salvar"]>> | undefined;
    await act(async () => {
      primeira = atual.salvar("loja@gmail.com", "abcdefghijklmnop");
      segunda = await atual.salvar("loja@gmail.com", "abcdefghijklmnop");
    });
    expect(segunda?.ok).toBe(false);
    expect(invokeFalso).toHaveBeenCalledTimes(2); // status + UM salvar
    await act(async () => {
      liberar({ data: STATUS_SALVO, error: null });
      await primeira;
    });
  });
});
