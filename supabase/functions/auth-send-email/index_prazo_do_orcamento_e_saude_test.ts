// Caça por mutação (25/11/2026) no hook `auth-send-email`: o orçamento de 3,5 s
// é conferido em quatro pontos e cada um impede um efeito diferente DEPOIS que o
// prazo acabou (abrir banco, seguir para o SMTP, mandar o segundo e-mail,
// declarar sucesso). Os testes antigos só esgotavam o orçamento dentro do
// import do SMTP, que é pego pelo último ponto de conferência — os outros três
// podiam sumir sem nenhum teste notar. Aqui o RELÓGIO é adiantado de mentira
// (`performance.now`), então nenhum teste dorme de verdade.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.1.1?target=deno";
import {
  AMBIENTE_COMPLETO,
  bancoFalso,
  capturandoLogs,
  CHAVE_CIFRA_TESTE,
  env,
  registroCifrado,
} from "../_shared/email-da-loja_fixtures.ts";
import { payload } from "../_shared/auth-email_fixtures.ts";
import { handler } from "./index.ts";

// Segredo de MENTIRA, determinístico (o mesmo molde dos outros testes do hook).
const SEGREDO = btoa("segredo-do-hook-totalmente-ficticio");
const AMBIENTE_HOOK = {
  SEND_EMAIL_HOOK_SECRET: `v1,whsec_${SEGREDO}`,
  SUPABASE_URL: "https://projeto.exemplo.com",
  MP_CHAVES_ENCRYPTION_KEY: CHAVE_CIFRA_TESTE,
};

function requisicaoAssinada(corpo: unknown = payload()) {
  const texto = JSON.stringify(corpo);
  const quando = new Date();
  return new Request("https://host-do-pedido-inseguro.example.com", {
    method: "POST",
    headers: {
      "webhook-id": "evento-ficticio",
      "webhook-timestamp": String(Math.floor(quando.getTime() / 1000)),
      "webhook-signature": new Webhook(SEGREDO).sign("evento-ficticio", quando, texto),
      "Content-Type": "application/json",
    },
    body: texto,
  });
}

/** Relógio que anda para frente quando o teste manda (`performance.now` do hook).
 * `parado`: o tempo real não corre, só o salto — para medir frações de 1 ms. */
function relogioAdiantavel({ parado = false } = {}) {
  const original = performance.now;
  const congelado = original.call(performance);
  const base = parado ? () => congelado : original.bind(performance);
  let salto = 0;
  performance.now = () => base() + salto;
  return {
    adiantar: (ms: number) => {
      salto += ms;
    },
    restaurar: () => {
      performance.now = original;
    },
  };
}

type Cenario = {
  ambiente?: Record<string, string>;
  banco?: Parameters<typeof bancoFalso>[0];
  /** Roda quando o hook pergunta o nome da loja (devolve o que a tabela devolveria). */
  aoLerNome?: () => { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>;
  /** Roda quando o SMTP recebe cada mensagem. */
  aoEnviar?: (mensagem: any) => void;
};

function cenario(opcoes: Cenario = {}) {
  const banco = bancoFalso(opcoes.banco);
  const from = banco.from.bind(banco);
  const enviados: any[] = [];
  let clientesCriados = 0;
  const cliente = {
    from(tabela: string) {
      if (tabela !== "store_config") return from(tabela);
      return {
        select: () => ({
          limit: () => ({
            maybeSingle: async () => opcoes.aoLerNome?.() ?? { data: { store_name: "Loja da Praça" }, error: null },
          }),
        }),
      };
    },
  };
  const deps = {
    env: env(opcoes.ambiente ?? { ...AMBIENTE_HOOK, ...AMBIENTE_COMPLETO }),
    criarCliente: () => {
      clientesCriados++;
      return cliente;
    },
    smtp: {
      carregarNodemailer: async () => ({
        default: {
          createTransport: () => ({
            sendMail(mensagem: any) {
              enviados.push(mensagem);
              opcoes.aoEnviar?.(mensagem);
              return Promise.resolve({ accepted: [mensagem.to], rejected: [] });
            },
            close() {},
          }),
        },
      }),
    },
  };
  return { deps, banco, enviados, clientesCriados: () => clientesCriados };
}

/** Roda o hook com o relógio de mentira e devolve resposta, logs e as tarefas de saúde adiadas.
 * `msAteResponder` é o tempo REAL até o hook responder — sem as tarefas de fundo
 * (`waitUntil`), que no ar correm depois da resposta e não seguram o Auth. */
async function rodar(
  s: ReturnType<typeof cenario>,
  corpo: unknown,
  relogio: ReturnType<typeof relogioAdiantavel>,
) {
  const tarefas: Promise<unknown>[] = [];
  let resposta!: Response;
  let msAteResponder = 0;
  const logs = await capturandoLogs(async () => {
    const inicio = Date.now();
    resposta = await handler(requisicaoAssinada(corpo), {
      ...s.deps,
      waitUntil: (tarefa: Promise<unknown>) => tarefas.push(tarefa),
    });
    msAteResponder = Date.now() - inicio;
  });
  await Promise.all(tarefas);
  relogio.restaurar();
  return { resposta, logs, tarefas, msAteResponder };
}

Deno.test("prazo acabou logo depois da assinatura: 500 tempo_esgotado e o hook nem cria o client do banco", async () => {
  const relogio = relogioAdiantavel();
  const s = cenario();
  const verificarOriginal = Webhook.prototype.verify;
  Webhook.prototype.verify = function (...args: any[]) {
    const corpo = verificarOriginal.apply(this, args);
    relogio.adiantar(4000);
    return corpo;
  };
  try {
    const { resposta, logs } = await rodar(s, payload(), relogio);
    assertEquals(resposta.status, 500);
    assertStringIncludes(logs, "tempo_esgotado");
    assertEquals(s.clientesCriados(), 0, "depois do prazo não abre banco nem cofre");
    assertEquals(s.enviados, []);
  } finally {
    Webhook.prototype.verify = verificarOriginal;
    relogio.restaurar();
  }
});

Deno.test("prazo acabou enquanto o banco respondia, sem remetente configurado: o motivo é tempo_esgotado, não sem_remetente", async () => {
  const relogio = relogioAdiantavel();
  const s = cenario({
    ambiente: AMBIENTE_HOOK, // sem Gmail no painel e sem SMTP no ambiente: nenhum remetente
    aoLerNome: () => {
      relogio.adiantar(4000);
      return { data: { store_name: "Loja da Praça" }, error: null };
    },
  });
  try {
    const { resposta, logs } = await rodar(s, payload(), relogio);
    assertEquals(resposta.status, 500);
    assertStringIncludes(logs, "tempo_esgotado");
    assertEquals(logs.includes("sem_remetente"), false);
    assertEquals(s.enviados, []);
  } finally {
    relogio.restaurar();
  }
});

Deno.test("troca segura de e-mail: se o prazo acabou depois do primeiro envio, o segundo NÃO sai (500, uma mensagem só)", async () => {
  const relogio = relogioAdiantavel();
  const corpo = payload("email_change");
  corpo.email_data.token_new = "654321";
  corpo.email_data.token_hash_new = "hash-do-novo";
  const s = cenario({
    banco: { registro: await registroCifrado() },
    aoEnviar: () => relogio.adiantar(4000),
  });
  try {
    const { resposta, logs } = await rodar(s, corpo, relogio);
    assertEquals(resposta.status, 500);
    assertEquals(s.enviados.length, 1, "o segundo e-mail não pode sair depois do prazo");
    assertStringIncludes(logs, "tempo_esgotado");
  } finally {
    relogio.restaurar();
  }
});

Deno.test("o aceite do SMTP chegou depois do prazo: 500 tempo_esgotado e nenhuma saúde de 'envio ok' é registrada", async () => {
  const relogio = relogioAdiantavel();
  const s = cenario({ aoEnviar: () => relogio.adiantar(4000) });
  try {
    const { resposta, logs, tarefas } = await rodar(s, payload(), relogio);
    assertEquals(resposta.status, 500);
    assertStringIncludes(logs, "tempo_esgotado");
    assertEquals(s.enviados.length, 1);
    assertEquals(tarefas.length, 0, "declarar saúde 'ok' depois do prazo seria mentir para o painel");
    assertEquals(s.banco.estado.escritas, []);
  } finally {
    relogio.restaurar();
  }
});

Deno.test("resolver o remetente nunca gasta mais que o RESTO do orçamento: com 100 ms sobrando, o banco que pendura é largado em ~100 ms (não 700)", async () => {
  const relogio = relogioAdiantavel();
  const s = cenario({
    ambiente: { ...AMBIENTE_HOOK, ...AMBIENTE_COMPLETO },
    banco: { leitura: "pendura" },
  });
  const verificarOriginal = Webhook.prototype.verify;
  Webhook.prototype.verify = function (...args: any[]) {
    const corpo = verificarOriginal.apply(this, args);
    relogio.adiantar(3400); // sobram ~100 ms dos 3500
    return corpo;
  };
  try {
    // Mede a RESPOSTA, não as tarefas de fundo: a saúde adiada tem prazo próprio
    // (3 s) e, contra este banco que pendura tudo, mediria outra coisa.
    const { resposta, msAteResponder } = await rodar(s, payload(), relogio);
    assertEquals(resposta.status, 500);
    assert(msAteResponder < 450, `o banco pendurado segurou o hook por ${msAteResponder} ms`);
  } finally {
    Webhook.prototype.verify = verificarOriginal;
    relogio.restaurar();
  }
});

// A fronteira do orçamento (26/11/2026). O SMTP conta o resto em ms INTEIROS
// (`Math.floor`): 0,6 ms para ele é 0, e ele recusa com ETIMEDOUT sem abrir
// conexão. O hook tinha outra conta (`ms <= 0`): com 0,6 ms ainda seguia, o SMTP
// recusava, e o hook dizia `envio_falhou` e marcava no painel uma falha de envio
// que nunca aconteceu. No CI isso acontece de verdade: o temporizador do banco
// dispara uma fração de ms antes do prazo. Relógio PARADO: a fração é exata.
const ORCAMENTO_MS = 3500; // o do hook (`index.ts`)

Deno.test("sobra 0,6 ms quando o banco responde: o hook usa a MESMA conta do SMTP, diz tempo_esgotado e não registra falha de envio", async () => {
  const relogio = relogioAdiantavel({ parado: true });
  const s = cenario({
    aoLerNome: () => {
      relogio.adiantar(ORCAMENTO_MS - 0.6);
      return { data: { store_name: "Loja da Praça" }, error: null };
    },
  });
  try {
    const { resposta, logs, tarefas } = await rodar(s, payload(), relogio);
    assertEquals(resposta.status, 500);
    assertStringIncludes(logs, "tempo_esgotado");
    assertEquals(logs.includes("envio_falhou"), false, logs);
    assertEquals(s.enviados, []);
    assertEquals(tarefas.length, 0, "nenhum e-mail foi tentado: não há saúde a registrar");
    assertEquals(s.banco.estado.escritas, [], "o painel não pode mostrar falha de envio que não aconteceu");
  } finally {
    relogio.restaurar();
  }
});

Deno.test("sobra 1,4 ms (1 ms inteiro para o SMTP): ainda é orçamento — o e-mail sai e a resposta é 200", async () => {
  const relogio = relogioAdiantavel({ parado: true });
  const s = cenario({
    aoLerNome: () => {
      relogio.adiantar(ORCAMENTO_MS - 1.4);
      return { data: { store_name: "Loja da Praça" }, error: null };
    },
  });
  try {
    const { resposta, logs } = await rodar(s, payload(), relogio);
    assertEquals(resposta.status, 200, logs);
    assertEquals(s.enviados.length, 1);
    assertEquals(logs.includes("tempo_esgotado"), false, logs);
  } finally {
    relogio.restaurar();
  }
});

Deno.test("erro inesperado com 0,6 ms sobrando: classificado pela MESMA conta (tempo_esgotado), não como envio_falhou", async () => {
  const relogio = relogioAdiantavel({ parado: true });
  const s = cenario();
  const deps = {
    ...s.deps,
    criarCliente: () => {
      relogio.adiantar(ORCAMENTO_MS - 0.6);
      throw new Error("falha inesperada ao criar o client");
    },
  };
  try {
    const { resposta, logs } = await rodar({ ...s, deps }, payload(), relogio);
    assertEquals(resposta.status, 500);
    assertStringIncludes(logs, "tempo_esgotado");
    assertEquals(logs.includes("envio_falhou"), false, logs);
  } finally {
    relogio.restaurar();
  }
});

Deno.test("envio aceito: a saúde registrada diz 'ok' da origem certa e NENHUMA falha (nunca uma falha depois de um e-mail entregue)", async () => {
  const s = cenario();
  const tarefas: Promise<unknown>[] = [];
  const r = await handler(requisicaoAssinada(), { ...s.deps, waitUntil: (t: Promise<unknown>) => tarefas.push(t) });
  assertEquals(r.status, 200);
  await Promise.all(tarefas);
  assertEquals(s.banco.estado.escritas.length, 1);
  const saude = JSON.parse(s.banco.estado.escritas[0].value!);
  assertEquals(saude.ultimo_envio_ok_origem, "ambiente");
  assert(typeof saude.ultimo_envio_ok_em === "string" && saude.ultimo_envio_ok_em.length > 0);
  assertEquals(saude.ultima_falha_em ?? null, null);
  assertEquals(saude.codigo_falha ?? null, null);
});

Deno.test("envio aceito pelo Gmail do painel: a saúde fica na origem 'painel'", async () => {
  const s = cenario({ banco: { registro: await registroCifrado() } });
  const tarefas: Promise<unknown>[] = [];
  const r = await handler(requisicaoAssinada(), { ...s.deps, waitUntil: (t: Promise<unknown>) => tarefas.push(t) });
  assertEquals(r.status, 200);
  await Promise.all(tarefas);
  const saude = JSON.parse(s.banco.estado.escritas[0].value!);
  assertEquals(saude.ultimo_envio_ok_origem, "painel");
  assertEquals(saude.codigo_falha ?? null, null);
});

Deno.test("nome da loja: em branco, com erro do banco ou não-texto cai no 'Nossa loja'; nome de verdade aparece no assunto", async () => {
  const casos: Array<[string, { data: unknown; error: unknown }, string]> = [
    ["só espaços", { data: { store_name: "   " }, error: null }, "Nossa loja"],
    ["erro do banco trazendo a linha", { data: { store_name: "Loja da Praça" }, error: { message: "falha parcial" } }, "Nossa loja"],
    ["nome que não é texto", { data: { store_name: 42 }, error: null }, "Nossa loja"],
    ["nome normal", { data: { store_name: "Loja da Praça" }, error: null }, "Loja da Praça"],
  ];
  for (const [rotulo, leitura, esperado] of casos) {
    const s = cenario({ aoLerNome: () => leitura });
    const r = await handler(requisicaoAssinada(), s.deps);
    assertEquals(r.status, 200, rotulo);
    assertEquals(s.enviados.length, 1, rotulo);
    assertStringIncludes(s.enviados[0].subject, esperado);
    if (esperado === "Nossa loja") assertEquals(s.enviados[0].subject.includes("Praça"), false, rotulo);
  }
});
