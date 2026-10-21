// Tudo é fictício: assinatura real, cofre AES real, banco e SMTP dublês.
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.1.1?target=deno";
import {
  AMBIENTE_COMPLETO,
  bancoFalso,
  capturandoLogs,
  CHAVE_CIFRA_TESTE,
  env,
  registroCifrado,
  SENHA_DO_PAINEL,
  USUARIO_DO_PAINEL,
} from "../_shared/email-da-loja_fixtures.ts";
import { payload } from "../_shared/auth-email_fixtures.ts";
import { handler } from "./index.ts";

// Segredo de MENTIRA, determinístico. Nunca lê segredos da máquina.
const SEGREDO = btoa("segredo-do-hook-totalmente-ficticio");
export const AMBIENTE_HOOK = {
  SEND_EMAIL_HOOK_SECRET: `v1,whsec_${SEGREDO}`,
  SUPABASE_URL: "https://projeto.exemplo.com",
  MP_CHAVES_ENCRYPTION_KEY: CHAVE_CIFRA_TESTE,
};

export function requisicaoAssinada(
  corpo: unknown = payload(),
  opcoes: { assinatura?: string; quando?: Date; texto?: string } = {},
) {
  const texto = opcoes.texto ?? JSON.stringify(corpo);
  const quando = opcoes.quando ?? new Date();
  return new Request("https://host-do-pedido-inseguro.example.com", {
    method: "POST",
    headers: {
      "webhook-id": "evento-ficticio",
      "webhook-timestamp": String(Math.floor(quando.getTime() / 1000)),
      "webhook-signature": opcoes.assinatura ??
        new Webhook(SEGREDO).sign("evento-ficticio", quando, texto),
      "Content-Type": "application/json",
    },
    body: texto,
  });
}

function cenario(opcoes: {
  ambiente?: Record<string, string>;
  banco?: Parameters<typeof bancoFalso>[0];
  enviar?: (m: any) => Promise<unknown>;
  carregar?: () => Promise<any>;
  nomePendurado?: boolean;
  saudeLenta?: Promise<any>;
} = {}) {
  const banco = bancoFalso(opcoes.banco);
  const from = banco.from.bind(banco);
  const consultas: string[] = [];
  const cliente = {
    from(tabela: string) {
      consultas.push(tabela);
      if (tabela !== "store_config") {
        const original = from(tabela);
        if (!opcoes.saudeLenta) return original;
        return {
          ...original,
          select: () => ({
            eq: (coluna: string, chave: string) => ({
              maybeSingle: () =>
                chave === "email_da_loja_saude"
                  ? opcoes.saudeLenta
                  : original.select().eq(coluna, chave).maybeSingle(),
            }),
          }),
        };
      }
      return {
        select: () => ({
          limit: () => ({
            maybeSingle: () =>
              opcoes.nomePendurado ? new Promise(() => {}) : Promise.resolve({
                data: { store_name: "Loja da Praça" },
                error: null,
              }),
          }),
        }),
      };
    },
  };
  const enviados: any[] = [];
  const configs: any[] = [];
  let criou = 0;
  const deps = {
    env: env(opcoes.ambiente ?? AMBIENTE_HOOK),
    criarCliente: () => {
      criou++;
      return cliente;
    },
    smtp: {
      carregarNodemailer: opcoes.carregar ?? (async () => ({
        default: {
          createTransport(config: unknown) {
            configs.push(config);
            return {
              sendMail(mensagem: any) {
                enviados.push(mensagem);
                return opcoes.enviar?.(mensagem) ??
                  Promise.resolve({ accepted: [mensagem.to], rejected: [] });
              },
              close() {},
            };
          },
        },
      })),
    },
  };
  return { deps, banco, consultas, enviados, configs, criou: () => criou };
}

Deno.test("hook registra saúde com waitUntil sem esperar o banco da saúde", async () => {
  let liberar!: (valor: any) => void;
  const saudeLenta = new Promise((r) => liberar = r);
  const s = cenario({
    ambiente: { ...AMBIENTE_HOOK, ...AMBIENTE_COMPLETO },
    saudeLenta,
  });
  const tarefas: Promise<unknown>[] = [];
  const inicio = performance.now();
  const r = await handler(requisicaoAssinada(), {
    ...s.deps,
    waitUntil: (tarefa: Promise<unknown>) => tarefas.push(tarefa),
  });
  assertEquals(r.status, 200);
  assert(performance.now() - inicio < 1000, "saúde bloqueou a resposta");
  assertEquals(tarefas.length, 1);
  assertEquals(s.banco.estado.escritas, []);
  liberar({ data: null, error: null });
  await Promise.all(tarefas);
  assertEquals(s.banco.estado.escritas.map((e) => e.key), [
    "email_da_loja_saude",
  ]);
});

const FALHA = {
  error: {
    http_code: 500,
    message:
      "Não foi possível enviar o e-mail agora. Tente de novo em instantes.",
  },
};

Deno.test("hook válido: envia pelo Gmail cifrado do painel; só responde depois de aceito, sem saúde nem reserva", async () => {
  let aceitar!: () => void;
  let enviando!: () => void;
  const chegou = new Promise<void>((r) => enviando = r);
  const s = cenario({
    banco: { registro: await registroCifrado() },
    ambiente: { ...AMBIENTE_HOOK, ...AMBIENTE_COMPLETO },
    enviar: () => {
      enviando();
      return new Promise<void>((r) => aceitar = r);
    },
  });
  let respondeu = false;
  const resposta = handler(requisicaoAssinada(), s.deps).then((r) => {
    respondeu = true;
    return r;
  });
  // Um handler sem envio precisa falhar, não deixar o teste pendurado.
  await Promise.race([chegou, resposta]);
  assertEquals(s.enviados.length, 1);
  assertEquals(respondeu, false);
  aceitar();
  const r = await resposta;
  assertEquals(r.status, 200);
  assertStringIncludes(r.headers.get("Content-Type") ?? "", "application/json");
  assertEquals(await r.json(), {});
  assertEquals(s.enviados[0].from, USUARIO_DO_PAINEL);
  assertEquals(s.enviados[0].to, "cliente@example.com");
  assertStringIncludes(s.enviados[0].subject, "Loja da Praça");
  assertStringIncludes(s.enviados[0].text, "type=signup");
  assertEquals(s.enviados[0].text.includes("123456"), false);
  assertEquals(s.configs[0].auth.pass, SENHA_DO_PAINEL);
  assert(
    s.configs[0].connectionTimeout > 0 &&
      s.configs[0].connectionTimeout <= 3500,
  );
  assert(s.configs[0].socketTimeout > 0 && s.configs[0].socketTimeout <= 3500);
  assertEquals(s.banco.estado.leituras, ["email_da_loja"]);
  assertEquals(s.banco.estado.escritas, []);
});

for (
  const falha of [
    "ausente",
    "adulterada",
    "corpo alterado",
    "vencida",
    "futura",
  ]
) {
  Deno.test(`hook assinatura ${falha}: 500 antes de criar client, ler cofre ou SMTP`, async () => {
    const s = cenario();
    let req = requisicaoAssinada(payload(), {
      ...(falha === "adulterada" ? { assinatura: "v1,assinatura-falsa" } : {}),
      ...(falha === "vencida"
        ? { quando: new Date(Date.now() - 360_000) }
        : {}),
      ...(falha === "futura" ? { quando: new Date(Date.now() + 360_000) } : {}),
    });
    if (falha === "ausente") req.headers.delete("webhook-signature");
    if (falha === "corpo alterado") {
      req = new Request(req, { body: JSON.stringify(payload("recovery")) });
    }
    const r = await handler(req, s.deps);
    assertEquals(r.status, 500);
    assertEquals(await r.json(), FALHA);
    assertEquals(s.criou(), 0);
    assertEquals(s.consultas, []);
    assertEquals(s.enviados, []);
  });
}

Deno.test("hook não reserializa corpo antes de conferir assinatura", async () => {
  const s = cenario({ ambiente: { ...AMBIENTE_HOOK, ...AMBIENTE_COMPLETO } });
  const r = await handler(
    requisicaoAssinada(payload(), {
      texto: JSON.stringify(payload(), null, 2) + "\n",
    }),
    s.deps,
  );
  assertEquals(r.status, 200);
  assertEquals(s.enviados.length, 1);
});

Deno.test("hook segredo ausente: falha fechada, sem acesso a banco ou envio", async () => {
  const s = cenario({ ambiente: { SUPABASE_URL: AMBIENTE_HOOK.SUPABASE_URL } });
  const r = await handler(requisicaoAssinada(), s.deps);
  assertEquals(r.status, 500);
  assertEquals(await r.json(), FALHA);
  assertEquals(s.criou(), 0);
  assertEquals(s.enviados, []);
});

Deno.test("hook sem Gmail nem ambiente: não devolve sucesso falso", async () => {
  const s = cenario();
  const r = await handler(requisicaoAssinada(), s.deps);
  assertEquals(r.status, 500);
  assertEquals(await r.json(), FALHA);
  assertEquals(s.enviados, []);
});

Deno.test("hook tipo desconhecido: recusa antes do cofre/SMTP", async () => {
  const s = cenario();
  const r = await handler(requisicaoAssinada(payload("desconhecido")), s.deps);
  assertEquals(r.status, 500);
  assertEquals(s.criou(), 0);
  assertEquals(s.enviados, []);
});

Deno.test("hook aviso de troca: envia ao endereço antigo, não ao atual", async () => {
  const s = cenario({ ambiente: { ...AMBIENTE_HOOK, ...AMBIENTE_COMPLETO } });
  const r = await handler(
    requisicaoAssinada(payload("email_changed_notification")),
    s.deps,
  );
  assertEquals(r.status, 200);
  assertEquals(s.enviados.map((e) => e.to), ["antigo@example.com"]);
});

for (const antigo of [undefined, "", "invalido", "a@example.com,b@example.com"]) {
  Deno.test(`hook aviso de troca com old_email inválido: ${String(antigo)} dá erro sem cofre/SMTP`, async () => {
    const corpo = payload("email_changed_notification");
    if (antigo === undefined) Reflect.deleteProperty(corpo.email_data, "old_email");
    else corpo.email_data.old_email = antigo;
    const s = cenario({ ambiente: { ...AMBIENTE_HOOK, ...AMBIENTE_COMPLETO } });
    const r = await handler(requisicaoAssinada(corpo), s.deps);
    assertEquals(r.status, 500);
    assertEquals(await r.json(), FALHA);
    assertEquals(s.criou(), 0);
    assertEquals(s.consultas, []);
    assertEquals(s.enviados, []);
  });
}

Deno.test("hook banco pendurado: usa reserva do ambiente com caminho rápido, sem saúde", async () => {
  const s = cenario({
    ambiente: { ...AMBIENTE_HOOK, ...AMBIENTE_COMPLETO },
    banco: { leitura: "pendura" },
    nomePendurado: true,
  });
  const inicio = performance.now();
  const r = await handler(requisicaoAssinada(), s.deps);
  assertEquals(r.status, 200);
  assertEquals(s.enviados.length, 1);
  assertEquals(s.enviados[0].from, AMBIENTE_COMPLETO.SMTP_USER);
  assert(
    performance.now() - inicio < 1800,
    "resolvedor/identidade não podem gastar 3 segundos cada",
  );
  assertEquals(s.banco.estado.escritas, []);
});

Deno.test("hook falha SMTP: sem retentativa, sem senha/código/hash/link/assinatura no log ou resposta", async () => {
  const req = requisicaoAssinada();
  const assinatura = req.headers.get("webhook-signature")!;
  const s = cenario({
    banco: { registro: await registroCifrado() },
    ambiente: { ...AMBIENTE_HOOK, ...AMBIENTE_COMPLETO },
    enviar: () =>
      Promise.reject(Object.assign(
        new Error(
          `${SENHA_DO_PAINEL} 123456 hash-atual-ficticio https://projeto.exemplo.com/auth/v1/verify ${assinatura}`,
        ),
        { code: "EAUTH" },
      )),
  });
  let r!: Response;
  const logs = await capturandoLogs(async () => r = await handler(req, s.deps));
  assertEquals(r.status, 500);
  const texto = await r.text();
  assertEquals(JSON.parse(texto), FALHA);
  assertEquals(s.enviados.length, 1);
  for (
    const segredo of [
      SENHA_DO_PAINEL,
      "123456",
      "hash-atual-ficticio",
      "https://",
      assinatura,
      SEGREDO,
    ]
  ) {
    assertEquals((texto + logs).includes(segredo), false);
  }
  assertStringIncludes(logs, "envio_falhou");
});

Deno.test("hook troca segura: falha no segundo envio dá 500, não repete o primeiro", async () => {
  const corpo = payload("email_change");
  corpo.email_data.token_new = "654321";
  corpo.email_data.token_hash_new = "hash-do-atual";
  let n = 0;
  const s = cenario({
    ambiente: { ...AMBIENTE_HOOK, ...AMBIENTE_COMPLETO },
    enviar: () =>
      ++n === 2
        ? Promise.reject(new Error("falha fictícia"))
        : Promise.resolve({}),
  });
  const tarefas: Promise<unknown>[] = [];
  const r = await handler(requisicaoAssinada(corpo), {
    ...s.deps,
    waitUntil: (tarefa) => tarefas.push(tarefa),
  });
  assertEquals(r.status, 500);
  await Promise.all(tarefas);
  assertEquals(tarefas.length, 1, "só o desfecho final deve gravar a saúde");
  const saude = JSON.parse(s.banco.estado.escritas[0].value!);
  assertEquals(saude.codigo_falha, "recusado");
  assertEquals(s.enviados.map((e) => e.to), [
    "cliente@example.com",
    "novo@example.com",
  ]);
  assertStringIncludes(s.enviados[0].text, "token=hash-do-atual");
  assertStringIncludes(s.enviados[1].text, "token=hash-atual-ficticio");
});

Deno.test("hook não deixa SMTP iniciar se import gastar todo o orçamento", async () => {
  let abriu = false;
  const s = cenario({
    ambiente: { ...AMBIENTE_HOOK, ...AMBIENTE_COMPLETO },
    carregar: async () => {
      await new Promise((r) => setTimeout(r, 3650));
      return {
        default: {
          createTransport: () => {
            abriu = true;
            throw new Error("tardio");
          },
        },
      };
    },
  });
  const inicio = performance.now();
  const r = await handler(requisicaoAssinada(), s.deps);
  const ms = performance.now() - inicio;
  assertEquals(r.status, 500);
  assert(ms >= 3000 && ms < 5000, `respondeu em ${ms} ms`);
  await new Promise((r) => setTimeout(r, 200));
  assertEquals(abriu, false);
});
