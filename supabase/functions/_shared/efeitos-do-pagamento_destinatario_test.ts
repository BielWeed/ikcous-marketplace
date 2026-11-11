// @ts-nocheck
/**
 * PARA QUEM vai o aviso de pagamento atrasado.
 *
 * O pedido de quem tem conta nasce sem e-mail: o destinatario sai de
 * `auth.admin.getUserById(linha.user_id)` em `dispararAvisoDePagamentoAtrasadoReal`.
 * Se o id fosse outro (`linha.id`, `orderId`), o aviso — que cita o numero do
 * pedido e o pagamento — iria para a caixa de OUTRA pessoa.
 *
 * O duble de `efeitos-do-pagamento_test.ts` (`bancoDeQuemTemConta`) tem um
 * `getUserById` que ignora o id e afirma um `para` fixo; trocar `user_id` por `id`
 * deixa aquela suite verde. Aqui o duble HONRA o id: cada conta devolve o e-mail
 * dela, o id recebido e' registrado e `para` e' afirmado contra o dono do pedido.
 *
 * Dados inventados: e-mails `@exemplo.com`, UUIDs fictícios.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { dispararAvisoDePagamentoAtrasadoReal } from "./efeitos-do-pagamento.ts";

const REMETENTE_OK = {
  origem: "ambiente",
  usuario: "loja@exemplo.com",
  senha: "senha-de-teste",
  motivo: null,
  reserva: null,
};

const PEDIDO_A = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const PEDIDO_B = "9e8d7c6b-5a49-4382-9716-0f1e2d3c4b5a";
const USUARIO_A = "11111111-2222-4333-8444-555555555555";
const USUARIO_B = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const EMAIL_DO_USUARIO_A = "dona-a@exemplo.com";
const EMAIL_DO_USUARIO_B = "dono-b@exemplo.com";
const EMAIL_DE_ID_ERRADO = "id-errado@exemplo.com";

function linhaDoPedido(id: string, userId: string) {
  return { id, user_id: userId, customer_data: {} };
}

function bancoFalso(pedidos: Array<Record<string, unknown>>, contas: Record<string, { email: string | null }>) {
  const idsDeConta: string[] = [];
  const rpcs: string[] = [];
  return {
    idsDeConta,
    rpcs,
    rpc: async (nome: string) => {
      rpcs.push(nome);
      return { data: nome === "reivindicar_email_de_confirmacao" ? true : null, error: null };
    },
    from(tabela: string) {
      return {
        select: () => ({
          eq: (_coluna: string, valor: unknown) => ({
            maybeSingle: async () => ({
              data: tabela === "marketplace_orders" ? pedidos.find((p) => p.id === valor) ?? null : null,
              error: null,
            }),
          }),
          limit: () => ({ maybeSingle: async () => ({ data: { store_name: "Loja Fixture" }, error: null }) }),
        }),
      };
    },
    auth: {
      admin: {
        getUserById: async (id: string) => {
          idsDeConta.push(id);
          if (id in contas) return { data: { user: { email: contas[id].email } }, error: null };
          // id que nao e' de conta nenhuma (ex.: id do pedido): e-mail de
          // "terceiro" — consultar o id errado aparece no `para`.
          return { data: { user: { email: EMAIL_DE_ID_ERRADO } }, error: null };
        },
      },
    },
  };
}

const CONTAS = {
  [USUARIO_A]: { email: EMAIL_DO_USUARIO_A },
  [USUARIO_B]: { email: EMAIL_DO_USUARIO_B },
};

async function avisar(banco, orderId: string) {
  const enviados: Array<{ para: string }> = [];
  const [e, w, l] = [console.error, console.warn, console.log];
  console.error = () => {};
  console.warn = () => {};
  console.log = () => {};
  try {
    await dispararAvisoDePagamentoAtrasadoReal({
      supabase: banco as never,
      orderId,
      deps: {
        resolverRemetente: async () => REMETENTE_OK,
        enviarEmail: async (args: { para: string }) => void enviados.push({ para: args.para }),
      },
    });
  } finally {
    [console.error, console.warn, console.log] = [e, w, l];
  }
  return enviados;
}

Deno.test("aviso atrasado: getUserById recebe o user_id DA LINHA do pedido, e o aviso vai para o e-mail desse dono", async () => {
  const banco = bancoFalso([linhaDoPedido(PEDIDO_A, USUARIO_A), linhaDoPedido(PEDIDO_B, USUARIO_B)], CONTAS);
  const enviados = await avisar(banco, PEDIDO_A);
  assertEquals(banco.idsDeConta, [USUARIO_A], "so o user_id do pedido pode ser consultado");
  assertEquals(enviados, [{ para: EMAIL_DO_USUARIO_A }]);
});

Deno.test("aviso atrasado: dois pedidos, duas contas -> cada aviso vai para o dono do SEU pedido", async () => {
  const banco = bancoFalso([linhaDoPedido(PEDIDO_A, USUARIO_A), linhaDoPedido(PEDIDO_B, USUARIO_B)], CONTAS);
  const a = await avisar(banco, PEDIDO_A);
  const b = await avisar(banco, PEDIDO_B);
  assertEquals(a, [{ para: EMAIL_DO_USUARIO_A }]);
  assertEquals(b, [{ para: EMAIL_DO_USUARIO_B }]);
  assertEquals(banco.idsDeConta, [USUARIO_A, USUARIO_B]);
});

Deno.test("aviso atrasado: a conta do dono nao tem e-mail -> nada e' enviado nem reservado (nao cai no e-mail de outra conta)", async () => {
  const banco = bancoFalso(
    [linhaDoPedido(PEDIDO_A, USUARIO_A), linhaDoPedido(PEDIDO_B, USUARIO_B)],
    { ...CONTAS, [USUARIO_A]: { email: null } },
  );
  const enviados = await avisar(banco, PEDIDO_A);
  assertEquals(enviados, []);
  assertEquals(banco.idsDeConta, [USUARIO_A]);
  assertEquals(banco.rpcs.includes("reivindicar_email_de_confirmacao"), false, "sem destinatario nao se gasta a reserva");
});
