// @vitest-environment jsdom
//
// Caça de provas fracas (24/11/2026), hook do e-mail da loja
// (`useEmailDaLoja`, edge `credenciais-email`): as CORRIDAS entre leituras e as
// falhas que NÃO podem derrubar o formulário. Dublê no lugar da edge; Gmail e
// senhas fictícios.
//   K1  releitura silenciosa que falha (depois de um teste ou de um salvar
//       torto) não troca o formulário por um erro;
//   K2  uma resposta de ERRO atrasada, depois de uma leitura mais nova ter
//       dado certo, não derruba a tela que já está pronta;
//   K3  o servidor já confirmou o salvar: uma leitura mais antiga, que chega
//       depois, não desfaz o que foi salvo;
//   K4  recarregar com a tela pronta não pisca para "carregando";
//   K5  terminada uma ação, a próxima roda (a trava de "uma por vez" solta);
//   K6  resposta torta do servidor: frase própria (não a do motivo), e o
//       status é relido; o aviso "admin:email-salvo" só sai quando o servidor
//       confirmou de verdade;
//   K7  erro com cara de HTTP mas sem resposta de verdade: frase genérica, nunca
//       uma exceção solta.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeFalso } = vi.hoisted(() => ({ invokeFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: invokeFalso } },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import {
  MENSAGEM_SEM_COFRE,
  mensagemDoMotivo,
} from "@/components/admin/settings/email-da-loja-conteudo";
import { type UseEmailDaLoja, useEmailDaLoja } from "@/hooks/useEmailDaLoja";

const STATUS_VAZIO = {
  usuario: null,
  senha_guardada: false,
  ultimo_teste: null,
  origem: "nenhuma",
  cofre_pronto: true,
  problema: null,
  saude: null,
};
const STATUS_SALVO = {
  ...STATUS_VAZIO,
  usuario: "loja@gmail.com",
  senha_guardada: true,
  origem: "painel",
  ultimo_teste: { ok: true, em: "2026-10-14T12:00:00Z", motivo: null },
};
const MENSAGEM_TORTA =
  "Não entendi a resposta do servidor. Tente de novo em instantes.";
const SENHA_FICTICIA = "abcdefghijklmnop";

const erroHttp = (status: number, corpo: unknown = {}) => ({
  name: "FunctionsHttpError",
  message: "Edge Function returned a non-2xx status code",
  context: new Response(JSON.stringify(corpo), { status }),
});
const erroDeRede = () => ({
  name: "FunctionsFetchError",
  message: "Failed to send a request to the Edge Function",
  context: new TypeError("Failed to fetch"),
});

type Resposta = { data: unknown; error: unknown };
function pendente() {
  let resolver!: (r: Resposta) => void;
  const promessa = new Promise<Resposta>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

let atual: UseEmailDaLoja;
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

const acoesChamadas = () =>
  invokeFalso.mock.calls.map(
    ([, opcoes]) => (opcoes as { body: { acao: string } }).body.acao,
  );

beforeEach(() => {
  invokeFalso.mockReset();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(async () => {
  await act(async () => {
    raiz?.unmount();
  });
  vi.restoreAllMocks();
});

describe("useEmailDaLoja: releitura silenciosa que falha não derruba a tela", () => {
  it("K1 testar: o teste passou e a releitura do status falhou na rede — segue pronto, com o status de antes", async () => {
    invokeFalso
      .mockResolvedValueOnce({ data: STATUS_SALVO, error: null })
      .mockResolvedValueOnce({ data: { ok: true }, error: null })
      .mockResolvedValueOnce({ data: null, error: erroDeRede() });
    await montar();

    let resultado: unknown;
    await act(async () => {
      resultado = await atual.testar();
    });
    expect(resultado).toEqual({ ok: true });
    expect(atual.carga).toBe("pronto");
    expect(atual.mensagemDeCarga).toBeNull();
    expect(atual.status?.usuario).toBe("loja@gmail.com");
  });

  it("K1b testar: a releitura volta TORTA — também segue pronto, sem tela de erro", async () => {
    invokeFalso
      .mockResolvedValueOnce({ data: STATUS_SALVO, error: null })
      .mockResolvedValueOnce({ data: { ok: true }, error: null })
      .mockResolvedValueOnce({ data: "lixo", error: null });
    await montar();

    await act(async () => {
      await atual.testar();
    });
    expect(atual.carga).toBe("pronto");
    expect(atual.mensagemDeCarga).toBeNull();
  });
});

describe("useEmailDaLoja: corridas entre leituras", () => {
  it("K2 erro ATRASADO de uma leitura antiga não derruba a tela que a leitura nova já deixou pronta", async () => {
    // A resposta de erro (404) da primeira leitura demora para ter o CORPO
    // lido; nesse meio-tempo a leitura nova termina bem.
    let liberarCorpo!: () => void;
    const corpoLento = new ReadableStream<Uint8Array>({
      start(controle) {
        liberarCorpo = () => {
          controle.enqueue(new TextEncoder().encode("{}"));
          controle.close();
        };
      },
    });
    invokeFalso
      .mockResolvedValueOnce({
        data: null,
        error: {
          name: "FunctionsHttpError",
          message: "Edge Function returned a non-2xx status code",
          context: new Response(corpoLento, { status: 404 }),
        },
      })
      .mockResolvedValueOnce({ data: STATUS_SALVO, error: null });
    await montar();

    await act(async () => {
      await atual.recarregar();
    });
    expect(atual.carga).toBe("pronto");

    await act(async () => {
      liberarCorpo();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(atual.carga).toBe("pronto");
    expect(atual.mensagemDeCarga).toBeNull();
    expect(atual.status?.usuario).toBe("loja@gmail.com");
  });

  it("K3 leitura antiga que chega DEPOIS do salvar confirmado não desfaz o que foi salvo", async () => {
    const leituraLenta = pendente();
    invokeFalso
      .mockReturnValueOnce(leituraLenta.promessa)
      .mockResolvedValueOnce({ data: STATUS_SALVO, error: null });
    await montar(); // a leitura da montagem fica pendente
    expect(atual.carga).toBe("carregando");

    await act(async () => {
      await atual.salvar("loja@gmail.com", SENHA_FICTICIA);
    });
    expect(atual.status?.usuario).toBe("loja@gmail.com");

    // Agora chega a resposta VELHA: dizia que não havia nada salvo.
    await act(async () => {
      leituraLenta.resolver({ data: STATUS_VAZIO, error: null });
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(atual.status?.usuario).toBe("loja@gmail.com");
    expect(atual.status?.senhaGuardada).toBe(true);
  });

  it("K4 recarregar com a tela já pronta não pisca para 'carregando'", async () => {
    invokeFalso.mockResolvedValueOnce({ data: STATUS_SALVO, error: null });
    await montar();
    expect(atual.carga).toBe("pronto");

    const segunda = pendente();
    invokeFalso.mockReturnValueOnce(segunda.promessa);
    let terminou: Promise<void> = Promise.resolve();
    await act(async () => {
      terminou = atual.recarregar();
    });
    expect(atual.carga).toBe("pronto");

    await act(async () => {
      segunda.resolver({ data: STATUS_SALVO, error: null });
      await terminou;
    });
    expect(atual.carga).toBe("pronto");
  });
});

describe("useEmailDaLoja: uma ação por vez, e a trava solta no fim", () => {
  it("K5 depois de uma ação terminar, a seguinte roda (não responde 'espere terminar')", async () => {
    invokeFalso
      .mockResolvedValueOnce({ data: STATUS_VAZIO, error: null })
      .mockResolvedValueOnce({ data: STATUS_SALVO, error: null })
      .mockResolvedValueOnce({ data: STATUS_VAZIO, error: null });
    await montar();

    let primeira: unknown;
    let segunda: unknown;
    await act(async () => {
      primeira = await atual.salvar("loja@gmail.com", SENHA_FICTICIA);
    });
    await act(async () => {
      segunda = await atual.remover();
    });
    expect(primeira).toEqual({ ok: true });
    expect(segunda).toEqual({ ok: true });
    expect(acoesChamadas()).toEqual(["status", "salvar", "remover"]);
    expect(atual.ocupado).toBeNull();
  });

  it("K5b mesmo quando a primeira ação FALHA, a trava solta", async () => {
    invokeFalso
      .mockResolvedValueOnce({ data: STATUS_VAZIO, error: null })
      .mockResolvedValueOnce({ data: null, error: erroHttp(500) })
      .mockResolvedValueOnce({ data: STATUS_SALVO, error: null });
    await montar();

    let primeira: { ok: boolean } | undefined;
    let segunda: { ok: boolean } | undefined;
    await act(async () => {
      primeira = await atual.salvar("loja@gmail.com", SENHA_FICTICIA);
    });
    await act(async () => {
      segunda = await atual.salvar("loja@gmail.com", SENHA_FICTICIA);
    });
    expect(primeira?.ok).toBe(false);
    expect(segunda?.ok).toBe(true);
  });
});

describe("useEmailDaLoja: resposta torta do servidor", () => {
  it("K6 testar com resposta torta: frase de 'não entendi', nunca a do motivo", async () => {
    for (const torta of [{}, null, { ok: "sim" }]) {
      invokeFalso.mockReset();
      invokeFalso
        .mockResolvedValueOnce({ data: STATUS_SALVO, error: null })
        .mockResolvedValueOnce({ data: torta, error: null })
        .mockResolvedValueOnce({ data: STATUS_SALVO, error: null });
      await montar();
      let resultado: { ok: boolean; mensagem?: string } | undefined;
      await act(async () => {
        resultado = await atual.testar();
      });
      expect(resultado).toEqual({ ok: false, mensagem: MENSAGEM_TORTA });
      await act(async () => {
        raiz.unmount();
      });
    }
  });

  it("K6b testar com ok:false: a frase do motivo (ou a de 'recusado', sem motivo)", async () => {
    invokeFalso
      .mockResolvedValueOnce({ data: STATUS_SALVO, error: null })
      .mockResolvedValueOnce({
        data: { ok: false, motivo: "limite_diario" },
        error: null,
      })
      .mockResolvedValueOnce({ data: STATUS_SALVO, error: null })
      .mockResolvedValueOnce({ data: { ok: false }, error: null })
      .mockResolvedValueOnce({ data: STATUS_SALVO, error: null });
    await montar();
    let r1: { ok: boolean; mensagem?: string } | undefined;
    let r2: { ok: boolean; mensagem?: string } | undefined;
    await act(async () => {
      r1 = await atual.testar();
    });
    await act(async () => {
      r2 = await atual.testar();
    });
    expect(r1).toEqual({
      ok: false,
      mensagem: mensagemDoMotivo("limite_diario"),
    });
    expect(r2).toEqual({ ok: false, mensagem: mensagemDoMotivo("recusado") });
  });

  it("K6c salvar com resposta torta: não diz que salvou, e RELÊ o status para a tela não ficar no escuro", async () => {
    invokeFalso
      .mockResolvedValueOnce({ data: STATUS_VAZIO, error: null })
      .mockResolvedValueOnce({ data: "lixo", error: null })
      .mockResolvedValueOnce({ data: STATUS_SALVO, error: null });
    await montar();
    let resultado: { ok: boolean; mensagem?: string } | undefined;
    await act(async () => {
      resultado = await atual.salvar("loja@gmail.com", SENHA_FICTICIA);
    });
    expect(resultado).toEqual({ ok: false, mensagem: MENSAGEM_TORTA });
    expect(acoesChamadas()).toEqual(["status", "salvar", "status"]);
    // A releitura trouxe o que o servidor realmente tem.
    expect(atual.status?.usuario).toBe("loja@gmail.com");
  });

  it("K6d o aviso 'admin:email-salvo' só sai quando o servidor confirmou (salvar e remover ok), nunca em falha ou resposta torta", async () => {
    const ouvinte = vi.fn();
    window.addEventListener("admin:email-salvo", ouvinte);
    try {
      invokeFalso
        .mockResolvedValueOnce({ data: STATUS_VAZIO, error: null })
        .mockResolvedValueOnce({ data: null, error: erroHttp(500) }) // salvar falha
        .mockResolvedValueOnce({ data: "lixo", error: null }) // salvar torto
        .mockResolvedValueOnce({ data: STATUS_VAZIO, error: null }) // releitura do torto
        .mockResolvedValueOnce({ data: STATUS_SALVO, error: null }) // salvar ok
        .mockResolvedValueOnce({ data: STATUS_VAZIO, error: null }); // remover ok
      await montar();
      await act(async () => {
        await atual.salvar("loja@gmail.com", SENHA_FICTICIA);
      });
      await act(async () => {
        await atual.salvar("loja@gmail.com", SENHA_FICTICIA);
      });
      expect(ouvinte).not.toHaveBeenCalled();
      await act(async () => {
        await atual.salvar("loja@gmail.com", SENHA_FICTICIA);
      });
      expect(ouvinte).toHaveBeenCalledTimes(1);
      await act(async () => {
        await atual.remover();
      });
      expect(ouvinte).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener("admin:email-salvo", ouvinte);
    }
  });

  it("K6e salvar com sucesso limpa o aviso de erro de carga que estava na tela", async () => {
    invokeFalso
      .mockResolvedValueOnce({ data: null, error: erroHttp(500) })
      .mockResolvedValueOnce({ data: STATUS_SALVO, error: null });
    await montar();
    expect(atual.carga).toBe("erro");
    expect(atual.mensagemDeCarga).not.toBeNull();

    await act(async () => {
      await atual.salvar("loja@gmail.com", SENHA_FICTICIA);
    });
    expect(atual.carga).toBe("pronto");
    expect(atual.mensagemDeCarga).toBeNull();
  });
});

describe("useEmailDaLoja: erro que parece HTTP mas não tem resposta de verdade", () => {
  it("K7 nome de erro HTTP com `context` que não é uma Response: frase genérica, sem exceção solta", async () => {
    invokeFalso
      .mockResolvedValueOnce({ data: STATUS_VAZIO, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { name: "FunctionsHttpError", context: { status: 500 } },
      });
    await montar();
    let resultado: { ok: boolean; mensagem?: string } | undefined;
    await act(async () => {
      resultado = await atual.salvar("loja@gmail.com", SENHA_FICTICIA);
    });
    expect(resultado?.ok).toBe(false);
    expect(resultado?.mensagem).toContain("Algo saiu do previsto");
  });

  it("K7b 503 ao salvar diz que a loja não guarda senha com segurança; 503 ao ler vira 'indisponível'", async () => {
    invokeFalso
      .mockResolvedValueOnce({ data: null, error: erroHttp(503) })
      .mockResolvedValueOnce({ data: null, error: erroHttp(503) });
    await montar();
    expect(atual.carga).toBe("indisponivel");

    let resultado: { ok: boolean; mensagem?: string } | undefined;
    await act(async () => {
      resultado = await atual.salvar("loja@gmail.com", SENHA_FICTICIA);
    });
    expect(resultado).toEqual({ ok: false, mensagem: MENSAGEM_SEM_COFRE });
  });
});
