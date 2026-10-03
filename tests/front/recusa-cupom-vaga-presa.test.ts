import { classificarRecusaDoPedido } from "@/lib/recusaDoPedido";
import { describe, expect, it } from "vitest";

const p0001 = (message: string) => ({ code: "P0001", message });

// PEÇA 12 (Fase 2, migrations 20261151000000): a frase canônica que o banco
// devolve quando a recusa é por limite E existe vaga presa do cupom — pedido
// `status='cancelled' AND coupon_usage_returned = FALSE`. A frase é ÚNICA nas
// três funções (validate_coupon_secure_v2, v23, v24 — lição #53) e o
// classificador precisa mapeá-la para a MESMA ação das outras recusas de
// cupom: remover o cupom. A âncora irmã
// (recusa-do-pedido-ancora-nas-migrations.test.ts) garante que a frase existe
// no SQL; esta garante que ela NUNCA cai no caso genérico `conferir_antes`.
const FRASE_NOVA = (codigo: string) =>
  `O cupom ${codigo} está no limite de usos. A vaga dele volta sozinha quando o pagamento de um pedido cancelado deixar de ser possível (em até 24 horas).`;

describe("classificarRecusaDoPedido — cupom no limite com vaga presa (peça 12)", () => {
  it("a frase nova -> remover_cupom, com o código capturado e a mensagem do banco preservada", () => {
    const r = classificarRecusaDoPedido(p0001(FRASE_NOVA("PRIMEIRA10")));
    expect(r.acao).toBe("remover_cupom");
    expect(r.produto).toBe("PRIMEIRA10");
    expect(r.mensagem).toBe(FRASE_NOVA("PRIMEIRA10"));
  });

  it("código com caracteres estranhos (digitado pelo lojista) também casa", () => {
    // `[\s\S]` e não `.` — mesmo motivo das regras de produto: o código é
    // digitado pelo lojista e pode vir com quebra de linha (medido na revisão
    // de 28/08/2026 com "Caneca\nAzul").
    const r = classificarRecusaDoPedido(p0001(FRASE_NOVA("NATAL\n25")));
    expect(r.acao).toBe("remover_cupom");
    expect(r.produto).toBe("NATAL\n25");
  });

  it("a frase antiga de limite (caso SEM vaga presa) continua casando", () => {
    const r = classificarRecusaDoPedido(
      p0001("O cupom PRIMEIRA10 já atingiu o limite de usos."),
    );
    expect(r.acao).toBe("remover_cupom");
    expect(r.produto).toBe("PRIMEIRA10");
  });

  it("a frase residual da corrida ('inválido ou expirado') continua casando", () => {
    const r = classificarRecusaDoPedido(
      p0001("Cupom PRIMEIRA10 inválido ou expirado."),
    );
    expect(r.acao).toBe("remover_cupom");
  });

  it("texto parecido mas truncado NÃO casa a regra nova (cai no genérico, como hoje)", () => {
    // Se alguém encurtar a frase no SQL, a âncora de migrations reprova; aqui
    // o que se prova é que a regex não casa MENSAGEM parcial por acidente —
    // o caso genérico preserva o texto e não oferece ação errada.
    const r = classificarRecusaDoPedido(
      p0001(
        "O cupom PRIMEIRA10 está no limite de usos. A vaga dele volta sozinha.",
      ),
    );
    expect(r.acao).toBe("conferir_antes");
  });
});
