/**
 * O `send-otp-email` só trabalha com os TRÊS campos (e-mail, WhatsApp e o
 * fragmento do pedido). Faltando QUALQUER UM, a resposta é `pedido_invalido`
 * ANTES de resolver remetente, gravar código ou mandar e-mail — uma validação
 * que aceitasse "dois de três" geraria um código (e queimaria o freio de 60 s)
 * para um pedido que não existe.
 *
 * A suíte vizinha só recusava o corpo vazio inteiro; aqui cada campo falta
 * sozinho, e também vazio/em branco. Dublês locais; ids inventados.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

const COMPLETO = { email: "cliente@example.com", whatsapp: "11900000000", orderFragment: "ABC123" };

function cenario() {
  const chamadas = { remetentes: 0, rpcs: 0, consultas: 0, enviados: 0 };
  const supabase = {
    rpc: () => {
      chamadas.rpcs++;
      return Promise.resolve({ data: null, error: null });
    },
    from() {
      chamadas.consultas++;
      throw new Error("não deve consultar nada com o corpo incompleto");
    },
  };
  return {
    chamadas,
    deps: {
      supabase,
      resolverRemetente: () => {
        chamadas.remetentes++;
        return Promise.resolve({ origem: "nenhum" as const });
      },
      enviarEmail: () => {
        chamadas.enviados++;
        return Promise.resolve();
      },
    } as never,
  };
}

function pedir(corpo: Record<string, unknown>) {
  return new Request("http://local/send-otp-email", { method: "POST", body: JSON.stringify(corpo) });
}

for (const campo of ["email", "whatsapp", "orderFragment"] as const) {
  for (const valor of [undefined, "", null]) {
    Deno.test(`corpo sem '${campo}' (${valor === undefined ? "ausente" : JSON.stringify(valor)}): pedido_invalido e NADA acontece (sem remetente, sem RPC, sem e-mail)`, async () => {
      const c = cenario();
      const corpo: Record<string, unknown> = { ...COMPLETO };
      if (valor === undefined) Reflect.deleteProperty(corpo, campo);
      else Reflect.set(corpo, campo, valor);
      const r = await handler(pedir(corpo), c.deps);
      assertEquals(await r.json(), { ok: false, motivo: "pedido_invalido" });
      assertEquals(c.chamadas, { remetentes: 0, rpcs: 0, consultas: 0, enviados: 0 });
    });
  }
}

Deno.test("CONTROLE: com os três campos o fluxo SEGUE (chega a resolver o remetente)", async () => {
  const c = cenario();
  const r = await handler(pedir(COMPLETO), c.deps);
  assertEquals((await r.json()).motivo, "sem_remetente");
  assertEquals(c.chamadas.remetentes, 1);
});
