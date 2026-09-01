/**
 * O comprador para de ler o erro cru do banco/edge function na hora de
 * fechar o pedido ou de conferir o código de acompanhamento.
 *
 * DOIS caminhos cobertos, e por que são DOIS testes de tradução separados
 * (não um só): `createOrder` (Ponto 2, chama create_marketplace_order_v23/
 * v24) e `fetchOrdersByOtp` (Ponto 3, chama get_orders_by_otp_v1) recusam
 * por causas DIFERENTES — a primeira função levanta RAISE EXCEPTION em
 * português (código 'P0001') para toda validação de negócio; a segunda
 * NUNCA levanta RAISE, ela sempre RETORNA um jsonb com `ok`/`error` já
 * tratado antes deste catch, então qualquer coisa que chegue ao catch ali é
 * falha em CHEGAR à verificação, nunca o código em si.
 *
 * `mensagemAmigavelErroPedido` e `mensagemAmigavelErroOtp` são exportadas de
 * useOrders.ts porque CheckoutView.tsx (Ponto 1) recebe o MESMO erro
 * relançado por createOrder e precisa da MESMA tradução — duplicar a lógica
 * dos causos de P0001 em dois arquivos divergiria assim que a RPC mudasse.
 *
 * POR QUE ESTE TESTE "DESLIGA" O REACT DE VERDADE: mesmo dublê de
 * create-order-rpc.test.ts (useState/useCallback/useEffect/useRef viram
 * passagens diretas) — useOrders() roda como função síncrona comum, com o
 * MESMO corpo que o app usa. E o mock de "@/lib/supabase"/"sonner" cria os
 * vi.fn() DENTRO da fábrica (nunca referenciando const de fora): variável de
 * fora referenciada ali cai em "cannot access before initialization", porque
 * vi.mock é IÇADO acima de qualquer const do arquivo (ver o comentário grande
 * em use-orders-otp-so-promete-o-que-enviou.test.tsx sobre o mesmo risco).
 */
vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  return {
    ...real,
    useState: (inicial: unknown) => [
      typeof inicial === "function" ? (inicial as () => unknown)() : inicial,
      vi.fn(),
    ],
    useCallback: (fn: unknown) => fn,
    useEffect: () => {},
    useRef: (inicial: unknown) => ({ current: inicial }),
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAdmin: false }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import {
  mensagemAmigavelErroOtp,
  mensagemAmigavelErroPedido,
  useOrders,
} from "@/hooks/useOrders";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

const DADOS_MINIMOS = {
  items: [{ productId: "prod-1", quantity: 1 }],
  totalAmount: 100,
  shippingCost: 0,
  paymentMethod: "pix",
  customer: { name: "Joana", whatsapp: "11999999999" },
};

describe("mensagemAmigavelErroPedido — as causas do create_marketplace_order_v23/v24", () => {
  it("P0001 (RAISE EXCEPTION da RPC) é confiável — sai em português, específica, e o pedido nunca foi criado", () => {
    // Texto real de supabase/migrations/20260821000200_cupom_sem_limite_e_ilimitado.sql
    const erroDoBanco = {
      code: "P0001",
      message: "Estoque insuficiente para o produto Caneca Azul",
      details: "",
      hint: "",
    };
    expect(mensagemAmigavelErroPedido(erroDoBanco)).toBe(
      "Estoque insuficiente para o produto Caneca Azul",
    );
  });

  it("outro código de erro do servidor (permissão, tipo, etc.): frase genérica, nunca o texto técnico", () => {
    const erroTecnico = {
      code: "42501",
      message: "permission denied for function create_marketplace_order_v24",
    };
    const msg = mensagemAmigavelErroPedido(erroTecnico);
    expect(msg).not.toContain("permission denied");
    expect(msg).not.toContain("function");
    expect(msg).toBe(
      "Não foi possível criar seu pedido agora. Tente novamente em instantes.",
    );
  });

  it("falha de rede: NÃO manda 'tente de novo' sem ressalva — o pedido pode ter sido criado mesmo sem resposta", () => {
    // Formato real que postgrest-js devolve quando o fetch lança (ver
    // node_modules/@supabase/postgrest-js/dist/index.cjs) — code vazio,
    // message com o nome do erro do fetch.
    const erroDeRede = {
      code: "",
      message: "TypeError: Failed to fetch",
    };
    const msg = mensagemAmigavelErroPedido(erroDeRede);
    expect(msg).toContain("Verifique se ele já apareceu");
    expect(msg).not.toBe(
      "Não foi possível criar seu pedido agora. Tente novamente em instantes.",
    );
  });

  it("mensagem ausente ou não-string: cai na ressalva de duplicidade, sem quebrar (achado B, 22/08/2026: sem code nenhum é o caso MAIS desconhecido que existe — não dá para presumir 'tente de novo')", () => {
    expect(mensagemAmigavelErroPedido(null)).toBe(
      "Não conseguimos confirmar se o pedido foi enviado. Verifique se ele já apareceu antes de tentar de novo.",
    );
    expect(mensagemAmigavelErroPedido(new Error())).toBe(
      "Não conseguimos confirmar se o pedido foi enviado. Verifique se ele já apareceu antes de tentar de novo.",
    );
  });

  // Achado B da revisão de 22/08/2026: o default tem de FALHAR FECHADO. Só o
  // conjunto de códigos com reversão COMPROVADA (a função nunca chegou a
  // rodar, ou rodou e foi cancelada — nos dois casos a transação inteira foi
  // revertida) pode herdar "tente novamente". Tudo mais — inclusive o que
  // hoje nem tem `code` — herda a ressalva de duplicidade.
  it("resposta sem JSON (502/504/524 de gateway) — postgrest-js devolve { message: <corpo> } SEM `code`: tem de cair na ressalva de duplicidade, NUNCA em 'tente novamente'", () => {
    // Formato real: quando res.ok é false e o corpo não é JSON, postgrest-js
    // monta error = { message: body } sem propriedade `code` nenhuma (ver
    // node_modules/@supabase/postgrest-js/dist/index.cjs, por volta da linha
    // 418). É a forma de um 502/504/524 de gateway — a transação pode ter
    // commitado no Postgres antes de a resposta se perder no caminho de
    // volta.
    const erroDeGateway = {
      message: "<html><body><h1>502 Bad Gateway</h1></body></html>",
    };
    const msg = mensagemAmigavelErroPedido(erroDeGateway);
    expect(msg).toContain("Verifique se ele já apareceu");
    expect(msg).not.toBe(
      "Não foi possível criar seu pedido agora. Tente novamente em instantes.",
    );
  });

  // Regra SQLSTATE (A2-fix2, 22/08/2026): a lista fixa de 5 códigos foi
  // trocada por uma regra de FORMATO. `code` com 5 caracteres [0-9A-Z] é o
  // formato de todo SQLSTATE que o próprio Postgres emite — e como cada RPC
  // do PostgREST é UMA transação sem bloco EXCEPTION WHEN (medido nas RPCs
  // vivas create_marketplace_order_v23/v24: 0 EXCEPTION WHEN, 10 RAISE
  // EXCEPTION, 0 USING ERRCODE), qualquer erro que chegue ao cliente
  // carregando esse formato só pode significar que o statement abortou —
  // logo a transação inteira reverteu, revertido ou não catalogado à mão.
  // "XX999" NÃO é um código catalogado (a classe XX do Postgres só documenta
  // 000/001/002), mas TEM o formato — e é exatamente por isso que ele passou
  // a contar como revertido: a prova não depende de estar numa lista, só de
  // ter vindo de dentro do Postgres.
  it("código de servidor com FORMATO de SQLSTATE mas não catalogado à mão (5 caracteres [0-9A-Z]): conta como revertido, mesmo sem estar em nenhuma lista", () => {
    const erroDesconhecido = { code: "XX999", message: "erro nunca visto" };
    const msg = mensagemAmigavelErroPedido(erroDesconhecido);
    expect(msg).toBe(
      "Não foi possível criar seu pedido agora. Tente novamente em instantes.",
    );
  });

  it("40P01 (deadlock_detected) e 55P03 (lock_not_available): não estavam na lista fixa antiga, mas têm formato SQLSTATE e contam como revertidos — o gatilho real é concorrência (dois carrinhos disputando o mesmo produto)", () => {
    expect(
      mensagemAmigavelErroPedido({
        code: "40P01",
        message: "deadlock detected",
      }),
    ).toBe(
      "Não foi possível criar seu pedido agora. Tente novamente em instantes.",
    );
    expect(
      mensagemAmigavelErroPedido({
        code: "55P03",
        message: "could not obtain lock on row in relation",
      }),
    ).toBe(
      "Não foi possível criar seu pedido agora. Tente novamente em instantes.",
    );
  });

  it("código que NÃO tem o formato de SQLSTATE (minúsculo, ou fora de 5 caracteres): cai na ressalva de duplicidade — formato é o que prova que veio do Postgres, e este não prova", () => {
    const codigoMinusculo = mensagemAmigavelErroPedido({
      code: "xx999",
      message: "algo",
    });
    expect(codigoMinusculo).toContain("Verifique se ele já apareceu");

    const codigoComTamanhoErrado = mensagemAmigavelErroPedido({
      code: "ERRO_INTERNO_DESCONHECIDO",
      message: "algo",
    });
    expect(codigoComTamanhoErrado).toContain("Verifique se ele já apareceu");
  });

  it("57014 (statement_timeout) comprovadamente reverteu a transação inteira: mantém 'tente novamente', NÃO vira ressalva de duplicidade", () => {
    // Cancelamento por timeout aborta a transação inteira que o PostgREST
    // abre para a chamada de RPC — mesmo raciocínio do RAISE documentado
    // acima, por outra via.
    const erroDeTimeout = {
      code: "57014",
      message: "canceling statement due to statement timeout",
    };
    expect(mensagemAmigavelErroPedido(erroDeTimeout)).toBe(
      "Não foi possível criar seu pedido agora. Tente novamente em instantes.",
    );
  });

  it("PGRST202 (função não existe no cache do PostgREST) e 22P02 (cast do parâmetro falhou): nenhum dos dois chega a rodar a função — mantêm 'tente novamente'", () => {
    expect(
      mensagemAmigavelErroPedido({
        code: "PGRST202",
        message:
          "Could not find the function public.create_marketplace_order_v24",
      }),
    ).toBe(
      "Não foi possível criar seu pedido agora. Tente novamente em instantes.",
    );
    expect(
      mensagemAmigavelErroPedido({
        code: "22P02",
        message: "invalid input syntax for type uuid",
      }),
    ).toBe(
      "Não foi possível criar seu pedido agora. Tente novamente em instantes.",
    );
  });

  // ANOTADO 1 da revisão de A2-fix3 (22/08/2026): PGRST301 (erro de
  // verificação do JWT — inválido ou expirado) e PGRST302 (papel anônimo
  // desabilitado, sem sessão) são REVERTIDO COMPROVADO, do mesmo jeito que
  // PGRST202 — confirmado na doc oficial do PostgREST (docs.postgrest.org/
  // en/v12/references/errors.html): os dois acontecem na fase de
  // autenticação, ANTES de qualquer requisição chegar ao Postgres, então a
  // função nunca roda. Sem este tratamento os dois têm 8 caracteres — não
  // batem [0-9A-Z]{5} — e caíam no default conservador, fazendo quem tem
  // token vencido ler "não conseguimos confirmar se o pedido foi enviado"
  // sobre um pedido que nunca existiu.
  it("PGRST301 (JWT inválido/expirado) e PGRST302 (papel anônimo desabilitado): nenhum dos dois chega a invocar a função — mantêm 'tente novamente', nunca a ressalva de duplicidade", () => {
    expect(
      mensagemAmigavelErroPedido({
        code: "PGRST301",
        message: "JWT expired",
      }),
    ).toBe(
      "Não foi possível criar seu pedido agora. Tente novamente em instantes.",
    );
    expect(
      mensagemAmigavelErroPedido({
        code: "PGRST302",
        message: "Anonymous access is disabled",
      }),
    ).toBe(
      "Não foi possível criar seu pedido agora. Tente novamente em instantes.",
    );
  });

  // ANOTADO 2 da revisão de A2-fix3 (22/08/2026): a guarda `&& textoOriginal`
  // no ramo P0001 não tinha teste nenhum cobrindo o caso em que ela decide
  // algo — RAISE EXCEPTION sem texto (ou com texto vazio) é raro, mas se
  // acontecer a guarda impede `mensagemAmigavelErroPedido` de devolver ""
  // (o que deixaria o toast vazio); em vez disso cai no ramo de formato
  // SQLSTATE logo abaixo, que também bate para "P0001", e devolve a frase
  // genérica de "tente novamente".
  it("P0001 sem message (ou com message vazia): a guarda evita devolver string vazia — cai na frase genérica, nunca em ''", () => {
    expect(mensagemAmigavelErroPedido({ code: "P0001", message: "" })).not.toBe(
      "",
    );
    expect(mensagemAmigavelErroPedido({ code: "P0001", message: "" })).toBe(
      "Não foi possível criar seu pedido agora. Tente novamente em instantes.",
    );
    expect(mensagemAmigavelErroPedido({ code: "P0001" })).not.toBe("");
  });
});

describe("mensagemAmigavelErroOtp — as causas do get_orders_by_otp_v1", () => {
  it("falha de rede: avisa sobre a conexão, nunca 'código inválido' — o código nem chegou a ser conferido", () => {
    const erroDeRede = { code: "", message: "TypeError: Failed to fetch" };
    const msg = mensagemAmigavelErroOtp(erroDeRede);
    expect(msg).toContain("Sem conexão");
    expect(msg).not.toContain("Código inválido");
  });

  it("qualquer outra falha do servidor: frase honesta de 'não conseguimos verificar', nunca 'código inválido'", () => {
    const erroTecnico = { code: "PGRST202", message: "function not found" };
    const msg = mensagemAmigavelErroOtp(erroTecnico);
    expect(msg).not.toContain("function not found");
    expect(msg).not.toContain("Código inválido");
    expect(msg).toBe(
      "Não conseguimos verificar seu código agora. Tente novamente em instantes.",
    );
  });
});

describe("createOrder RELANÇA a recusa sem toast — o aviso único é da tela (Ponto 2)", () => {
  // Laudo 31/08 (menor E): falha de criação empilhava DOIS toasts — este
  // hook toastava E o CheckoutView toastava de novo, os dois com a MESMA
  // tradução. O aviso único mora na tela, que é quem acrescenta o painel da
  // recusa ao lado do toast; a garantia "nunca texto cru no toast" continua
  // provada LÁ (checkout-view-erro-de-pedido-traduzido.test.tsx, render de
  // verdade) e na tradução pura (describe acima).
  beforeEach(() => {
    vi.mocked(supabase.rpc).mockReset();
    vi.mocked(supabase.functions.invoke).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("RPC recusa com P0001 em português: o erro SOBE sem toast do hook", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "Cupom PROMO10 inválido ou expirado." },
    } as any);
    const { createOrder } = useOrders(false, false);

    await expect(createOrder(DADOS_MINIMOS)).rejects.toThrow();

    expect(toast.error).not.toHaveBeenCalled();
  });

  it("RPC recusa com erro técnico cru: nada de toast do hook — o erro cru segue só no console de quem chamou", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "marketplace_orders_pkey"',
      },
    } as any);
    const { createOrder } = useOrders(false, false);

    await expect(createOrder(DADOS_MINIMOS)).rejects.toThrow();

    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("fetchOrdersByOtp toasta a versão traduzida, nunca o err.message cru (Ponto 3)", () => {
  beforeEach(() => {
    vi.mocked(supabase.rpc).mockReset();
    vi.mocked(supabase.functions.invoke).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("a chamada nem teve resposta (rede caiu): o toast NUNCA diz 'código inválido' nem mostra o texto cru", async () => {
    vi.mocked(supabase.rpc).mockRejectedValue(
      new Error("TypeError: Failed to fetch"),
    );
    const { fetchOrdersByOtp } = useOrders(false, false);

    const resultado = await fetchOrdersByOtp("a@b.c", "123456");

    expect(resultado).toEqual([]);
    expect(toast.error).toHaveBeenCalledTimes(1);
    const mensagemMostrada = String(vi.mocked(toast.error).mock.calls[0][0]);
    expect(mensagemMostrada).not.toContain("Código inválido");
    expect(mensagemMostrada).not.toContain("TypeError");
    expect(mensagemMostrada).toContain("Sem conexão");
  });

  // B2 da revisão de A2-fix3 (22/08/2026): a verificação do código deu certo
  // (`data.ok === true`) mas `orders` veio vazio. A ÚNICA causa viva disso é
  // uma corrida dentro da própria RPC — o pedido foi apagado ENTRE o SELECT
  // que acha o código e o RETURN que monta o JSON, na mesma chamada (a FK de
  // otp_verifications.order_id é NOT NULL + ON DELETE CASCADE, então fora
  // dessa janela a linha do OTP já teria sido apagada junto). Antes deste
  // teste, `fetchOrdersByOtp` devolvia `[]` sem toast nenhum aqui, e
  // OrderSearch.tsx também não toasta nesse caminho (por desenho — um dono
  // só do toast) — a tela ficava muda: a pessoa aperta "verificar" e nada
  // acontece.
  it("data.ok === true mas orders vem vazio (corrida rara na própria RPC): toasta — este é o ÚNICO lugar onde a causa é conhecida", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: { ok: true, orders: [] },
      error: null,
    } as any);
    const { fetchOrdersByOtp } = useOrders(false, false);

    const resultado = await fetchOrdersByOtp("a@b.c", "123456");

    expect(resultado).toEqual([]);
    expect(toast.error).toHaveBeenCalledTimes(1);
    const mensagemMostrada = String(vi.mocked(toast.error).mock.calls[0][0]);
    // A RPC já marcou `verified = TRUE` antes de devolver — o código FOI
    // aceito. "Tente novamente" manda repetir uma ação que nunca vai dar
    // certo (o próximo toque lê "Código inválido ou expirado", que também é
    // falso: o código valia). A frase certa não pode mandar repetir nada, e
    // não pode dizer que o código era inválido.
    expect(mensagemMostrada).toBe(
      "Seu código foi verificado, mas esse pedido não está mais disponível. Fale com a loja.",
    );
    expect(mensagemMostrada).not.toMatch(/tente novamente/i);
    expect(mensagemMostrada).not.toMatch(/código inválido/i);
  });

  it("data.ok === true com orders preenchido: NÃO toasta — o resultado real não pode ganhar um erro por cima", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: {
        ok: true,
        orders: [
          {
            id: "order-1",
            user_id: null,
            total: 100,
            subtotal: 100,
            shipping: 0,
            discount: 0,
            payment_method: "pix",
            status: "pending",
            payment_status: "paid",
            items: [],
          },
        ],
      },
      error: null,
    } as any);
    const { fetchOrdersByOtp } = useOrders(false, false);

    const resultado = await fetchOrdersByOtp("a@b.c", "123456");

    expect(resultado).toHaveLength(1);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
