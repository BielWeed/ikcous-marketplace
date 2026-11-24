// Lojista que perdeu o cargo (login ainda vivo por cerca de 1 hora) salvava em
// Frete e lia "Não foi possível falar com o servidor. Tente de novo em
// instantes." — o servidor tinha dito 403 (ou o gateway 401), mas o tradutor só
// conhecia fetch/404/503, e "tentar de novo" nunca funcionaria. O ramo é
// OPT-IN: quem não pede mantém a frase de sempre (a cotação do comprador, por
// exemplo, não muda nada).

import { MENSAGEM_SESSAO_OU_PERMISSAO } from "@/lib/erro-de-sessao-do-painel";
import { mensagemAmigavelErroEdgeFunction } from "@/lib/mensagens-erro";
import { describe, expect, it } from "vitest";

const GENERICA = "Não foi possível falar com o servidor. Tente de novo.";
const INATIVO = "Este serviço não está ativo nesta loja.";

function erroHttp(status: number) {
  return {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: new Response("{}", { status }),
  };
}

describe("mensagemAmigavelErroEdgeFunction — sessão ou permissão (opt-in)", () => {
  it.each([401, 403])(
    "HTTP %i com a opção ligada: diz que a sessão/permissão acabou",
    (status) => {
      expect(
        mensagemAmigavelErroEdgeFunction(erroHttp(status), {
          mensagemGenerica: GENERICA,
          mensagemSessaoOuPermissao: true,
        }),
      ).toBe(MENSAGEM_SESSAO_OU_PERMISSAO);
    },
  );

  it.each([401, 403])(
    "HTTP %i SEM a opção: segue a frase genérica de sempre",
    (status) => {
      expect(
        mensagemAmigavelErroEdgeFunction(erroHttp(status), {
          mensagemGenerica: GENERICA,
        }),
      ).toBe(GENERICA);
    },
  );

  it.each([404, 503])(
    "HTTP %i com a opção ligada e serviço inativo: continua a frase de serviço inativo",
    (status) => {
      expect(
        mensagemAmigavelErroEdgeFunction(erroHttp(status), {
          mensagemGenerica: GENERICA,
          mensagemServicoInativo: INATIVO,
          mensagemSessaoOuPermissao: true,
        }),
      ).toBe(INATIVO);
    },
  );

  it.each([400, 404, 500, 503])(
    "HTTP %i com a opção ligada (sem serviço inativo): continua a genérica",
    (status) => {
      expect(
        mensagemAmigavelErroEdgeFunction(erroHttp(status), {
          mensagemGenerica: GENERICA,
          mensagemSessaoOuPermissao: true,
        }),
      ).toBe(GENERICA);
    },
  );

  it("falha de fetch com a opção ligada: continua a frase de rede", () => {
    expect(
      mensagemAmigavelErroEdgeFunction(
        { name: "FunctionsFetchError", message: "Failed to fetch" },
        { mensagemGenerica: GENERICA, mensagemSessaoOuPermissao: true },
      ),
    ).toBe(
      "Sem conexão com o servidor. Verifique sua internet e tente novamente.",
    );
  });

  it("erro que não é HTTP (sem context de Response) com a opção ligada: genérica", () => {
    expect(
      mensagemAmigavelErroEdgeFunction(
        { name: "FunctionsHttpError", context: { status: 403 } },
        { mensagemGenerica: GENERICA, mensagemSessaoOuPermissao: true },
      ),
    ).toBe(GENERICA);
    expect(
      mensagemAmigavelErroEdgeFunction(new Error("x"), {
        mensagemGenerica: GENERICA,
        mensagemSessaoOuPermissao: true,
      }),
    ).toBe(GENERICA);
  });
});
