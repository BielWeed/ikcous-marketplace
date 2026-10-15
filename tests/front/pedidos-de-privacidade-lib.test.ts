// Régua pura dos pedidos de privacidade (src/lib/pedidos-de-privacidade.ts): e-mail novo, classificação da
// falha de gravar, leitura defensiva das linhas e "o pedido mais recente de cada tipo".
import {
  classificarFalhaDoPedido,
  formatarDataDoPedido,
  lerPedidosDePrivacidade,
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

describe("validarEmailNovo", () => {
  it("limpa as pontas, põe em minúscula e aceita um e-mail normal", () => {
    expect(
      validarEmailNovo("  Maria.Nova+loja@Exemplo.com.br ", "x@y.com"),
    ).toEqual({ ok: true, email: "maria.nova+loja@exemplo.com.br" });
  });

  it.each([
    ["", "vazio"],
    ["   ", "vazio"],
    ["semarroba.com", "formato"],
    ["a@semponto", "formato"],
    ["a b@c.com", "formato"],
    ["@c.com", "formato"],
    ["a@@c.com", "formato"],
    [`${"a".repeat(250)}@c.com`, "formato"],
  ])("recusa %j (%s)", (digitado, motivo) => {
    expect(validarEmailNovo(digitado, "x@y.com")).toEqual({
      ok: false,
      motivo,
    });
  });

  it("recusa o e-mail que já é o da conta, sem ligar para maiúscula nem espaço", () => {
    expect(validarEmailNovo(" MARIA@exemplo.com", "maria@exemplo.com")).toEqual(
      {
        ok: false,
        motivo: "igual",
      },
    );
  });

  it("sem e-mail atual conhecido, não recusa por 'igual'", () => {
    expect(validarEmailNovo("a@b.com", null)).toEqual({
      ok: true,
      email: "a@b.com",
    });
  });
});

describe("classificarFalhaDoPedido", () => {
  it.each([
    [{ code: "23505", message: "dup" }, "ja_existe"],
    [{ code: "42501", message: "rls" }, "sem_sessao"],
    [{ code: "PGRST301", message: "jwt" }, "sem_sessao"],
    [{ code: "23514", message: "check" }, "outra"],
    [{ message: "TypeError: Failed to fetch" }, "sem_rede"],
    [{ code: "", message: "x" }, "sem_rede"],
    [new TypeError("Failed to fetch"), "sem_rede"],
    [null, "sem_rede"],
    ["texto solto", "sem_rede"],
  ])("%j vira %s", (erro, esperado) => {
    expect(classificarFalhaDoPedido(erro)).toBe(esperado);
  });
});

describe("lerPedidosDePrivacidade", () => {
  it("lê as linhas boas e descarta as de forma estranha, sem derrubar nada", () => {
    const lidas = lerPedidosDePrivacidade([
      linha(),
      linha({ id: "p2", tipo: "apagar_tudo" }),
      linha({ id: "p3", situacao: "sumiu" }),
      linha({ id: "p4", criado_em: 5 }),
      null,
      "x",
      linha({ id: "p5", tipo: "corrigir_email", email_novo: "a@b.com" }),
    ]);
    expect(lidas.map((p) => p.id)).toEqual(["p1", "p5"]);
    expect(lidas[1].email_novo).toBe("a@b.com");
  });

  it("aceita lista nula ou ausente", () => {
    expect(lerPedidosDePrivacidade(null)).toEqual([]);
    expect(lerPedidosDePrivacidade(undefined)).toEqual([]);
  });
});

describe("ultimoPedidoDoTipo", () => {
  it("devolve o mais recente do tipo pedido e ignora o outro tipo", () => {
    const pedidos = lerPedidosDePrivacidade([
      linha({
        id: "velho",
        criado_em: "2026-09-01T12:00:00Z",
        situacao: "recusado",
      }),
      linha({ id: "novo", criado_em: "2026-10-01T12:00:00Z" }),
      linha({
        id: "email",
        tipo: "corrigir_email",
        email_novo: "a@b.com",
        criado_em: "2026-10-10T12:00:00Z",
      }),
    ]);
    expect(ultimoPedidoDoTipo(pedidos, "excluir_conta")?.id).toBe("novo");
    expect(ultimoPedidoDoTipo(pedidos, "corrigir_email")?.id).toBe("email");
    expect(ultimoPedidoDoTipo([], "excluir_conta")).toBeNull();
  });
});

describe("formatarDataDoPedido", () => {
  it("formata em dia/mês/ano e devolve vazio para data ausente ou ilegível", () => {
    expect(formatarDataDoPedido("2026-10-14T12:00:00Z")).toBe("14/10/2026");
    expect(formatarDataDoPedido(null)).toBe("");
    expect(formatarDataDoPedido("não é data")).toBe("");
  });
});
