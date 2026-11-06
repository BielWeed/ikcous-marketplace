// Falha de `registrar_venda_presencial` com código que o arquivo não conhecia:
// o texto do banco chegava CRU, em inglês ("deadlock detected", "canceling
// statement due to statement timeout"), com `podeTentarDeNovo:false` — a tela
// então desabilitava "Registrar venda" e só oferecia "Começar uma venda nova",
// que apaga a venda inteira, com a cliente esperando no caixa e nada gravado.
//
// Por que repetir é seguro (conferido em
// supabase/migrations/20261280000000_o_balcao_registra_so_o_total_conferido.sql):
// a RPC é UMA função plpgsql — erro levantado nela desfaz cabeçalho, itens e
// baixa de estoque juntos — e a mesma `p_idempotency_key` devolve o pedido que
// já existe (`ja_existia`) em vez de gravar outro.
import { describe, expect, it } from "vitest";

import {
  MENSAGEM_DE_REDE_DA_VENDA,
  mensagemDaFalhaDaVenda,
} from "@/lib/erro-da-venda-presencial";

const OCUPADO =
  "O sistema estava ocupado e a venda não foi registrada. Toque em Registrar venda de novo — o estoque não foi descontado.";
const OUTRA_VENDA =
  "Outra venda estava mexendo nos mesmos produtos. Toque em Registrar venda de novo.";
const GENERICA =
  "Não foi possível registrar a venda agora. Confira a conexão e tente de novo; se continuar, avise o suporte.";
const ENTRAR_DE_NOVO =
  "A sua sessão expirou. Saia e entre de novo na conta; a venda fica salva aqui.";

const INGLES_DO_POSTGRES = [
  "deadlock detected",
  "canceling statement due to statement timeout",
  "could not serialize access due to concurrent update",
  "could not obtain lock on row in relation",
  "JWT expired",
  "something exploded in english",
];

function semTextoCru(mensagem: string): void {
  for (const cru of INGLES_DO_POSTGRES) {
    expect(mensagem.toLowerCase()).not.toContain(cru.toLowerCase());
  }
}

describe("mensagemDaFalhaDaVenda — falha passageira do banco convida a repetir", () => {
  it.each([
    ["40001", "could not serialize access due to concurrent update"],
    ["57014", "canceling statement due to statement timeout"],
    ["55P03", "could not obtain lock on row in relation"],
    ["53300", "too many connections for role"],
    ["53200", "out of memory"],
  ])("%s: frase em português, pode repetir, sem texto cru", (code, message) => {
    const r = mensagemDaFalhaDaVenda({ code, message });
    expect(r).toEqual({
      mensagem: OCUPADO,
      podeTentarDeNovo: true,
      precisaEntrarDeNovo: false,
    });
    semTextoCru(r.mensagem);
  });

  it("40P01 (deadlock) diz que outra venda mexia nos mesmos produtos", () => {
    const r = mensagemDaFalhaDaVenda({
      code: "40P01",
      message: "deadlock detected",
    });
    expect(r).toEqual({
      mensagem: OUTRA_VENDA,
      podeTentarDeNovo: true,
      precisaEntrarDeNovo: false,
    });
    semTextoCru(r.mensagem);
  });
});

describe("mensagemDaFalhaDaVenda — conexão caída pode ter gravado: mesma frase honesta da rede", () => {
  // Erro de conexão/queda do servidor pode chegar DEPOIS do commit. A tela só
  // mostra "Não sabemos se a venda foi registrada" quando a frase é a da rede
  // (FechamentoDaVenda `talvezTenhaEntrado`), então estes códigos têm de cair
  // nela — não na frase "não foi registrada", que seria falsa se o commit saiu.
  it.each([
    ["08006", "connection failure"],
    ["08001", "unable to connect"],
    ["57P01", "terminating connection due to administrator command"],
    ["57P03", "the database system is starting up"],
  ])("%s", (code, message) => {
    const r = mensagemDaFalhaDaVenda({ code, message });
    expect(r).toEqual({
      mensagem: MENSAGEM_DE_REDE_DA_VENDA,
      podeTentarDeNovo: true,
      precisaEntrarDeNovo: false,
    });
  });
});

describe("mensagemDaFalhaDaVenda — sessão vencida", () => {
  it.each(["PGRST301", "PGRST302", "PGRST303"])(
    "%s manda entrar de novo, sem texto cru",
    (code) => {
      const r = mensagemDaFalhaDaVenda({ code, message: "JWT expired" });
      expect(r).toEqual({
        mensagem: ENTRAR_DE_NOVO,
        podeTentarDeNovo: false,
        precisaEntrarDeNovo: true,
      });
      semTextoCru(r.mensagem);
    },
  );
});

describe("mensagemDaFalhaDaVenda — código desconhecido nunca vaza o texto do banco", () => {
  it("XX999 com frase em inglês vira a frase genérica em português", () => {
    const r = mensagemDaFalhaDaVenda({
      code: "XX999",
      message: "something exploded in english",
    });
    expect(r).toEqual({
      mensagem: GENERICA,
      podeTentarDeNovo: true,
      precisaEntrarDeNovo: false,
    });
    semTextoCru(r.mensagem);
  });

  it("PGRST000 (banco inalcançável) e P0001 (RAISE sem código) também", () => {
    for (const code of ["PGRST000", "P0001", "23514", "42883"]) {
      const r = mensagemDaFalhaDaVenda({
        code,
        message: "something exploded in english",
      });
      expect(r.mensagem).toBe(GENERICA);
      expect(r.podeTentarDeNovo).toBe(true);
    }
  });

  it("código desconhecido sem frase também cai na genérica", () => {
    expect(mensagemDaFalhaDaVenda({ code: "XX999" }).mensagem).toBe(GENERICA);
  });

  it("prefixo só vale no começo do código: '40' e '08' no meio não contam", () => {
    for (const code of ["XX408", "XX0853", "X57P01"]) {
      expect(mensagemDaFalhaDaVenda({ code, message: "x" }).mensagem).toBe(
        GENERICA,
      );
    }
  });
});

describe("mensagemDaFalhaDaVenda — o que já era tratado segue idêntico", () => {
  it("PGRST202, 42501, 23505, 22023 e rede sem código", () => {
    expect(mensagemDaFalhaDaVenda({ code: "PGRST202" }).podeTentarDeNovo).toBe(
      false,
    );
    expect(
      mensagemDaFalhaDaVenda({ code: "42501", message: "Acesso negado" }),
    ).toEqual({
      mensagem: "Acesso negado",
      podeTentarDeNovo: false,
      precisaEntrarDeNovo: true,
    });
    expect(mensagemDaFalhaDaVenda({ code: "23505" }).mensagem).toBe(
      "Esta chave de venda já foi usada por outro pedido.",
    );
    expect(
      mensagemDaFalhaDaVenda({
        code: "22023",
        message: "Informe o motivo do desconto.",
      }).mensagem,
    ).toBe("Informe o motivo do desconto.");
    expect(mensagemDaFalhaDaVenda(new TypeError("Failed to fetch"))).toEqual({
      mensagem: MENSAGEM_DE_REDE_DA_VENDA,
      podeTentarDeNovo: true,
      precisaEntrarDeNovo: false,
    });
  });
});
