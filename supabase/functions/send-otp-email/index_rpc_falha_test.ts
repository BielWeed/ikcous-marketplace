// Só fixtures inventadas e dependências injetadas; nada de banco ou SMTP reais.
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

const PEDIDO = {
  email: "cliente@example.com",
  whatsapp: "11900000000",
  orderFragment: "ABC123",
};
const REMETENTE = {
  origem: "ambiente" as const,
  usuario: "remetente@example.com",
  senha: "senha-ficticia-do-teste",
  motivo: "sem_registro" as const,
  reserva: null,
};

function pedidoDeCodigo() {
  return new Request("http://local/send-otp-email", {
    method: "POST",
    body: JSON.stringify(PEDIDO),
  });
}

function cenario(error: { message: string } | null) {
  const chamadas = {
    remetentes: 0,
    rpcs: [] as Array<{ nome: string; parametros: unknown }>,
    consultas: [] as string[],
    enviados: [] as unknown[],
  };
  const supabase = {
    rpc: async (nome: string, parametros: unknown) => {
      chamadas.rpcs.push({ nome, parametros });
      return { data: null, error };
    },
    from(tabela: string) {
      chamadas.consultas.push(tabela);
      throw new Error("não deve consultar identidade após recusa da RPC");
    },
  };
  return {
    chamadas,
    deps: {
      supabase,
      resolverRemetente: async (cliente: unknown) => {
        assertEquals(cliente, supabase);
        chamadas.remetentes++;
        return REMETENTE;
      },
      enviarEmail: async (...args: unknown[]) => {
        chamadas.enviados.push(args);
      },
    },
  };
}

function exigirRpcSemEnvio(s: ReturnType<typeof cenario>) {
  assertEquals(s.chamadas.remetentes, 1);
  assertEquals(s.chamadas.rpcs, [{
    nome: "generate_order_otp_v2",
    parametros: {
      p_email: "cliente@example.com",
      p_whatsapp: "11900000000",
      p_order_fragment: "ABC123",
    },
  }]);
  assertEquals(s.chamadas.consultas, []);
  assertEquals(s.chamadas.enviados, []);
}

Deno.test("OTP com erro da RPC e data null responde 502 envio_falhou, nunca 200 nao_confere", async () => {
  const s = cenario({ message: "banco indisponível no teste" });
  const r = await handler(pedidoDeCodigo(), s.deps);
  assertEquals(r.status, 502);
  assertEquals(await r.json(), { ok: false, motivo: "envio_falhou" });
  exigirRpcSemEnvio(s);
});

Deno.test("OTP sem erro da RPC e data null continua respondendo 200 nao_confere", async () => {
  const s = cenario(null);
  const r = await handler(pedidoDeCodigo(), s.deps);
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { ok: false, motivo: "nao_confere" });
  exigirRpcSemEnvio(s);
});
