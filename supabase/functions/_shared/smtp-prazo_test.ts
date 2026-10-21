// Usa TCP local e o Nodemailer REAL (mesma versão da produção), sem Gmail.
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import nodemailer from "https://esm.sh/nodemailer@9.0.5?target=denonext";
import { enviarEmail } from "./smtp.ts";
import { handler } from "../auth-send-email/index.ts";
import { AMBIENTE_HOOK, requisicaoAssinada } from "./auth-email_fixtures.ts";
import {
  AMBIENTE_COMPLETO,
  bancoFalso,
  env,
} from "./email-da-loja_fixtures.ts";

const REMETENTE = {
  origem: "ambiente",
  usuario: "smtp-falso@example.com",
  senha: "senha-ficticia",
  motivo: null,
  reserva: null,
};
const MENSAGEM = {
  para: "cliente@example.com",
  assunto: "teste",
  html: "<p>teste</p>",
  texto: "teste",
};

/** Servidor controlado: nunca responde, ou mantém EHLO em progresso sem concluir.
 * A guarda de emergência fecha após o teste, e NÃO conta como cancelamento do cliente. */
function smtpLento(gotejar: boolean) {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const porta = (listener.addr as Deno.NetAddr).port;
  let conexao: Deno.Conn | undefined;
  let intervalo: ReturnType<typeof setInterval> | undefined;
  let fechouEm: number | undefined;
  let forçado = false;
  let encerrado = false;
  let recebeu = false;
  const encoder = new TextEncoder();
  const ciclo = (async () => {
    try {
      conexao = await listener.accept();
      recebeu = true;
      if (gotejar) {
        await conexao.write(encoder.encode("220 servidor-local\r\n"));
      }
      const buffer = new Uint8Array(4096);
      while (await conexao.read(buffer) !== null) {
        if (gotejar && !intervalo) {
          intervalo = setInterval(() => {
            conexao?.write(encoder.encode("250-progresso\r\n")).catch(() => {});
          }, 60);
        }
      }
      if (!forçado) fechouEm = performance.now();
    } catch {
      if (!forçado) fechouEm = performance.now();
    } finally {
      if (intervalo) clearInterval(intervalo);
      try {
        conexao?.close();
      } catch { /* já fechada */ }
    }
  })();
  return {
    recebeu: () => recebeu,
    fechouEm: () => fechouEm,
    carregarNodemailer: async () => ({
      default: {
        createTransport(config: any) {
          // Só muda o DESTINO para um servidor descartável; mantém todos os
          // timeouts e o getSocket da implementação em teste.
          return nodemailer.createTransport({
            ...config,
            host: "127.0.0.1",
            port: porta,
            secure: false,
            ignoreTLS: true,
            auth: undefined,
          });
        },
      },
    }),
    async fechar() {
      if (encerrado) return ciclo;
      encerrado = true;
      forçado = true;
      try {
        conexao?.close();
      } catch { /* já fechada */ }
      listener.close();
      await ciclo;
    },
  };
}

for (const gotejar of [false, true]) {
  Deno.test(`SMTP prazo absoluto: derruba socket real ${gotejar ? "com bytes lentos" : "sem saudação"}`, async () => {
    const servidor = smtpLento(gotejar);
    const inicio = performance.now();
    const guarda = setTimeout(() => void servidor.fechar(), 1000);
    try {
      await assertRejects(() =>
        enviarEmail(MENSAGEM, REMETENTE, {
          carregarNodemailer: servidor.carregarNodemailer,
          prazoFinalMs: inicio + 300,
        })
      );
      const ms = performance.now() - inicio;
      // A recusa tem de vir do prazo, não da guarda de emergência do TESTE.
      assert(ms < 800, `SMTP levou ${ms} ms`);
      assert(servidor.recebeu());
      await new Promise((r) => setTimeout(r, 30));
      assert(
        servidor.fechouEm() !== undefined,
        "cliente não derrubou o socket",
      );
      assert(servidor.fechouEm()! - inicio < 800);
      console.log(
        `SMTP local (${gotejar ? "progresso" : "saudação"}): ${
          Math.round(ms)
        } ms; socket encerrado`,
      );
    } finally {
      clearTimeout(guarda);
      await servidor.fechar();
    }
  });
}

Deno.test("hook SMTP real lento: 500 e socket encerrado dentro de cinco segundos", async () => {
  const servidor = smtpLento(true);
  const banco = bancoFalso();
  const cliente = {
    from(tabela: string) {
      if (tabela !== "store_config") return banco.from(tabela);
      return {
        select: () => ({
          limit: () => ({
            maybeSingle: async () => ({
              data: { store_name: "Loja" },
              error: null,
            }),
          }),
        }),
      };
    },
  };
  const inicio = performance.now();
  try {
    const r = await handler(requisicaoAssinada(), {
      env: env({ ...AMBIENTE_HOOK, ...AMBIENTE_COMPLETO }),
      criarCliente: () => cliente,
      smtp: { carregarNodemailer: servidor.carregarNodemailer },
    });
    const ms = performance.now() - inicio;
    assertEquals(r.status, 500);
    assert(servidor.recebeu(), "hook não chegou ao SMTP");
    assert(ms >= 3000 && ms < 5000, `hook levou ${ms} ms`);
    await new Promise((r) => setTimeout(r, 50));
    assert(
      servidor.fechouEm() !== undefined,
      "socket continuou ativo após timeout HTTP",
    );
    assert(servidor.fechouEm()! - inicio < 5000);
    console.log(`Hook local completo: ${Math.round(ms)} ms; socket encerrado`);
  } finally {
    await servidor.fechar();
  }
});
