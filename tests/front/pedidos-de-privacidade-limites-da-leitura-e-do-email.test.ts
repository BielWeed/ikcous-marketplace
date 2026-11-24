// Limites da régua pura dos pedidos de privacidade (src/lib/pedidos-de-privacidade.ts) que o teste vizinho
// (pedidos-de-privacidade-lib.test.ts) não pisa: o tamanho EXATO do e-mail (254 passa, 255 não — a mesma
// régua do CHECK do banco), a leitura que descarta linha sem id/user_id e preserva TODOS os campos da
// linha boa, a ordem das recusas do e-mail e a classificação de falha que não depende de texto.
// Dados inventados (*.invalid): nenhum dado real de cliente.
import {
  COLUNAS_DO_PEDIDO_DA_CLIENTE,
  COLUNAS_DO_PEDIDO_DE_PRIVACIDADE,
  classificarFalhaDoPedido,
  lerPedidosDePrivacidade,
  prazoFinalDoPedido,
  prazoVencido,
  ultimoPedidoDoTipo,
  validarEmailNovo,
} from "@/lib/pedidos-de-privacidade";
import { describe, expect, it } from "vitest";

const linha = (extra: Record<string, unknown> = {}) => ({
  id: "p1",
  user_id: "u1",
  tipo: "excluir_conta",
  email_novo: null,
  situacao: "aberto",
  criado_em: "2026-10-14T12:00:00Z",
  atendido_em: null,
  atendido_por: null,
  observacao: null,
  ...extra,
});

// Lê UMA linha pela régua e devolve o pedido (falha alto se a linha for descartada).
function lerUm(extra: Record<string, unknown> = {}) {
  const [pedido] = lerPedidosDePrivacidade([linha(extra)]);
  if (!pedido) throw new Error("a linha de teste deveria ser aceita");
  return pedido;
}

// "a@" + domínio + ".invalid" com o tamanho total pedido.
function emailComTamanho(total: number): string {
  const resto = total - "a@.invalid".length;
  return `a@${"d".repeat(resto)}.invalid`;
}

describe("validarEmailNovo: o limite de 254 caracteres é exato", () => {
  it("254 caracteres passa; 255 é recusado por formato", () => {
    const limite = emailComTamanho(254);
    const acima = emailComTamanho(255);
    expect(limite).toHaveLength(254);
    expect(acima).toHaveLength(255);
    expect(validarEmailNovo(limite, "x@y.invalid")).toEqual({
      ok: true,
      email: limite,
    });
    expect(validarEmailNovo(acima, "x@y.invalid")).toEqual({
      ok: false,
      motivo: "formato",
    });
  });

  it("o tamanho conta DEPOIS de limpar as pontas (espaço em volta não estoura o limite)", () => {
    const limite = emailComTamanho(254);
    expect(validarEmailNovo(`   ${limite}   `, "x@y.invalid")).toEqual({
      ok: true,
      email: limite,
    });
  });
});

describe("validarEmailNovo: ordem das recusas e formato", () => {
  it("o e-mail ATUAL da conta também é comparado sem maiúscula e sem espaço nas pontas", () => {
    // O e-mail de entrada pode ter vindo com maiúscula ou espaço; digitar o mesmo e-mail continua sendo 'igual'.
    expect(
      validarEmailNovo("maria@exemplo.invalid", " Maria@Exemplo.INVALID "),
    ).toEqual({ ok: false, motivo: "igual" });
    expect(
      validarEmailNovo("MARIA@exemplo.invalid", "Maria@Exemplo.invalid"),
    ).toEqual({ ok: false, motivo: "igual" });
  });

  it("e-mail fora do formato nunca é tratado como 'igual', mesmo que o e-mail atual seja igual a ele", () => {
    // Conta com e-mail atual quebrado: digitar o mesmo texto quebrado é 'formato', não 'igual'.
    expect(validarEmailNovo("semarroba", "semarroba")).toEqual({
      ok: false,
      motivo: "formato",
    });
  });

  it("só espaços é 'vazio' (não 'formato') e não consulta o e-mail atual", () => {
    expect(validarEmailNovo("   ", "")).toEqual({ ok: false, motivo: "vazio" });
    expect(validarEmailNovo("   ", "   ")).toEqual({
      ok: false,
      motivo: "vazio",
    });
  });

  it("e-mail atual vazio ou ausente NUNCA bloqueia um e-mail novo válido", () => {
    expect(validarEmailNovo("a@b.invalid", "")).toEqual({
      ok: true,
      email: "a@b.invalid",
    });
    expect(validarEmailNovo("a@b.invalid", undefined)).toEqual({
      ok: true,
      email: "a@b.invalid",
    });
  });

  it("espaço no meio (ou tabulação) recusa por formato; a régua é a do banco", () => {
    expect(validarEmailNovo("a@b .invalid", "x@y.invalid")).toEqual({
      ok: false,
      motivo: "formato",
    });
    expect(validarEmailNovo("a@b.in\tvalid", "x@y.invalid")).toEqual({
      ok: false,
      motivo: "formato",
    });
    expect(validarEmailNovo("a@b.invalid extra", "x@y.invalid")).toEqual({
      ok: false,
      motivo: "formato",
    });
  });

  it("uma segunda arroba depois do domínio recusa (a régua vale para o texto inteiro)", () => {
    expect(validarEmailNovo("a@b.invalid@c", "x@y.invalid")).toEqual({
      ok: false,
      motivo: "formato",
    });
  });
});

describe("lerPedidosDePrivacidade: descarta o que não tem identidade e preserva o que tem", () => {
  it("linha sem id, ou sem user_id, ou com eles fora de texto, some da lista", () => {
    const lidas = lerPedidosDePrivacidade([
      linha({ id: 7 }),
      linha({ id: undefined }),
      linha({ user_id: null }),
      linha({ user_id: 9 }),
      linha({ id: "ok" }),
    ]);
    expect(lidas.map((p) => p.id)).toEqual(["ok"]);
  });

  it("linha sem criado_em (ou com data que não é texto) some; tipo fora de texto também", () => {
    const lidas = lerPedidosDePrivacidade([
      linha({ id: "a", criado_em: undefined }),
      linha({ id: "b", criado_em: new Date() }),
      linha({ id: "c", tipo: 1 }),
      linha({ id: "d", situacao: null }),
      linha({ id: "e" }),
    ]);
    expect(lidas.map((p) => p.id)).toEqual(["e"]);
  });

  it("uma linha de cada tipo e de cada situação conhecida é aceita (a lista de formas é completa)", () => {
    const lidas = lerPedidosDePrivacidade([
      linha({ id: "1", tipo: "excluir_conta", situacao: "aberto" }),
      linha({ id: "2", tipo: "corrigir_email", situacao: "atendido" }),
      linha({ id: "3", tipo: "excluir_conta", situacao: "recusado" }),
    ]);
    expect(lidas.map((p) => `${p.tipo}/${p.situacao}`)).toEqual([
      "excluir_conta/aberto",
      "corrigir_email/atendido",
      "excluir_conta/recusado",
    ]);
  });

  it("preserva a ORDEM em que o banco devolveu as linhas", () => {
    const lidas = lerPedidosDePrivacidade([
      linha({ id: "z" }),
      linha({ id: "a" }),
      linha({ id: "m" }),
    ]);
    expect(lidas.map((p) => p.id)).toEqual(["z", "a", "m"]);
  });

  it("preserva todos os campos da linha atendida; campo que não é texto vira null", () => {
    const lida = lerUm({
      id: "p9",
      user_id: "u9",
      tipo: "corrigir_email",
      email_novo: "nova@exemplo.invalid",
      situacao: "atendido",
      criado_em: "2026-10-14T12:00:00Z",
      atendido_em: "2026-10-16T09:30:00Z",
      atendido_por: "loja-1",
      observacao: "Trocamos o e-mail.",
    });
    expect(lida).toEqual({
      id: "p9",
      user_id: "u9",
      tipo: "corrigir_email",
      email_novo: "nova@exemplo.invalid",
      situacao: "atendido",
      criado_em: "2026-10-14T12:00:00Z",
      atendido_em: "2026-10-16T09:30:00Z",
      atendido_por: "loja-1",
      observacao: "Trocamos o e-mail.",
    });

    const torta = lerUm({
      email_novo: 5,
      atendido_em: 5,
      atendido_por: { id: 1 },
      observacao: ["x"],
    });
    expect(torta).toMatchObject({
      email_novo: null,
      atendido_em: null,
      atendido_por: null,
      observacao: null,
    });
  });

  it("objeto vazio e array dentro da lista não derrubam a leitura", () => {
    expect(lerPedidosDePrivacidade([{}, [], 3, undefined])).toEqual([]);
  });
});

describe("classificarFalhaDoPedido: o texto da mensagem nunca decide", () => {
  it("mensagem falando de sessão ou duplicata, sem código, continua sendo falta de rede", () => {
    expect(
      classificarFalhaDoPedido({ message: "duplicate key value (23505)" }),
    ).toBe("sem_rede");
    expect(classificarFalhaDoPedido({ message: "JWT expired" })).toBe(
      "sem_rede",
    );
  });

  it("código que não é texto não vira 'outra': conta como sem código", () => {
    expect(classificarFalhaDoPedido({ code: 23505, message: "x" })).toBe(
      "sem_rede",
    );
  });

  it("código desconhecido do Postgres é 'outra' (o app não chuta rede nem sessão)", () => {
    expect(classificarFalhaDoPedido({ code: "40001", message: "x" })).toBe(
      "outra",
    );
    expect(classificarFalhaDoPedido({ code: "PGRST116", message: "x" })).toBe(
      "outra",
    );
  });
});

describe("ultimoPedidoDoTipo: empate e ordem", () => {
  it("o mais recente vence em qualquer ordem de entrada", () => {
    const velho = lerUm({ id: "v", criado_em: "2026-09-01T12:00:00Z" });
    const novo = lerUm({ id: "n", criado_em: "2026-10-01T12:00:00Z" });
    expect(ultimoPedidoDoTipo([velho, novo], "excluir_conta")?.id).toBe("n");
    expect(ultimoPedidoDoTipo([novo, velho], "excluir_conta")?.id).toBe("n");
  });

  it("empate de data fica com o PRIMEIRO da lista (o banco já ordena do mais novo)", () => {
    const lidas = lerPedidosDePrivacidade([
      linha({ id: "primeiro" }),
      linha({ id: "segundo" }),
    ]);
    expect(ultimoPedidoDoTipo(lidas, "excluir_conta")?.id).toBe("primeiro");
  });

  it("lista só com o OUTRO tipo devolve null", () => {
    const lidas = lerPedidosDePrivacidade([
      linha({ tipo: "corrigir_email", email_novo: "a@b.invalid" }),
    ]);
    expect(ultimoPedidoDoTipo(lidas, "excluir_conta")).toBeNull();
  });
});

describe("prazo do pedido com data ilegível", () => {
  it("data que não é data não inventa prazo e nunca marca o pedido como vencido", () => {
    expect(prazoFinalDoPedido("não é data")).toBeNull();
    expect(prazoFinalDoPedido("")).toBeNull();
    expect(prazoVencido("não é data", new Date("2030-01-01T00:00:00Z"))).toBe(
      false,
    );
    expect(prazoVencido("", new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });

  it("data boa: não vence no dia do pedido e vence bem depois do prazo", () => {
    const criado = "2026-10-14T12:00:00Z";
    expect(prazoVencido(criado, new Date("2026-10-14T12:00:00Z"))).toBe(false);
    expect(prazoVencido(criado, new Date("2027-10-14T12:00:00Z"))).toBe(true);
  });
});

describe("colunas que a tela da cliente lê", () => {
  it("nunca incluem `atendido_por` nem `*`, e são um subconjunto das colunas da loja", () => {
    const daCliente = COLUNAS_DO_PEDIDO_DA_CLIENTE.split(",").map((c) =>
      c.trim(),
    );
    const daLoja = COLUNAS_DO_PEDIDO_DE_PRIVACIDADE.split(",").map((c) =>
      c.trim(),
    );
    expect(daCliente).not.toContain("atendido_por");
    expect(daCliente).not.toContain("*");
    expect(daLoja).toContain("atendido_por");
    for (const coluna of daCliente) expect(daLoja).toContain(coluna);
    // Tudo o que a tela mostra precisa vir na leitura.
    for (const coluna of [
      "id",
      "user_id",
      "tipo",
      "email_novo",
      "situacao",
      "criado_em",
      "atendido_em",
      "observacao",
    ]) {
      expect(daCliente).toContain(coluna);
    }
  });
});
