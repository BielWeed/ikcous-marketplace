// Caça por mutação (25/11/2026) no contador de visitas da loja
// (`src/hospedagem/contador.ts`). Cada caso nasceu de um defeito de uma linha
// plantado de propósito que NENHUM dos três testes vizinhos derrubava: o que
// conta como PÁGINA (prefixos `/api`, `/.well-known`, extensão do arquivo), o
// que conta como NAVEGAÇÃO DE PESSOA quando o navegador manda só parte dos
// cabeçalhos Sec-Fetch, caixa alta nos cabeçalhos, ponto final de FQDN no host,
// a ordem Instagram/WhatsApp no user-agent e a janela de silêncio do log.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  classificarEntrada,
  ehPaginaContavel,
  registrarEntrada,
} from "@/hospedagem/contador";

const UA_CHROME =
  "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

function pagina(caminho: string, metodo = "GET"): boolean {
  return ehPaginaContavel(metodo, new URL(`https://loja-a.exemplo${caminho}`));
}

function entrada(url: string, cabecalhos: Record<string, string>) {
  return classificarEntrada({
    metodo: "GET",
    url: new URL(url),
    cabecalhos: new Headers(cabecalhos),
  });
}

const LOJA = "https://loja-a.exemplo";

describe("ehPaginaContavel — o que é página da loja (e o que não é)", () => {
  it("só os prefixos '/api/' e '/.well-known/' (com a barra) ficam de fora; nomes que apenas começam parecido contam", () => {
    expect(pagina("/api")).toBe(false);
    expect(pagina("/api/pedidos")).toBe(false);
    expect(pagina("/apixyz")).toBe(true);
    expect(pagina("/.well-known/assetlinks")).toBe(false);
    expect(pagina("/.well-knownx")).toBe(true);
  });

  it("a barra final não esconde a extensão: '/logo.png/' é arquivo, '/promo/' é página", () => {
    expect(pagina("/logo.png/")).toBe(false);
    expect(pagina("/promo/")).toBe(true);
    expect(pagina("/promo//")).toBe(true);
  });

  it("extensão de arquivo vale em qualquer caixa e com dígitos: .JPG, .Png, .mp4, .7z", () => {
    expect(pagina("/FOTO.JPG")).toBe(false);
    expect(pagina("/foto.Png")).toBe(false);
    expect(pagina("/video.mp4")).toBe(false);
    expect(pagina("/pacote.7z")).toBe(false);
  });

  it("só é extensão o que vem DEPOIS do último ponto até o fim e é só letra/dígito", () => {
    // Ponto no meio de um nome com traço: não é arquivo.
    expect(pagina("/promo.verao-2026")).toBe(true);
    // Ponto no fim, sem nada depois: não é arquivo.
    expect(pagina("/oferta.")).toBe(true);
    // O ponto de uma PASTA não faz arquivo.
    expect(pagina("/v1.2/oferta")).toBe(true);
  });

  it("HEAD e métodos que não são GET nunca contam", () => {
    expect(pagina("/", "HEAD")).toBe(false);
    expect(pagina("/", "POST")).toBe(false);
    expect(pagina("/", "GET")).toBe(true);
  });
});

describe("classificarEntrada — navegação de pessoa com Sec-Fetch incompleto ou em caixa alta", () => {
  it("valores de Sec-Fetch em caixa alta ('Navigate'/'Document') ainda são navegação de pessoa", () => {
    expect(
      entrada(`${LOJA}/`, {
        "user-agent": UA_CHROME,
        "sec-fetch-mode": "Navigate",
        "sec-fetch-dest": "Document",
      }),
    ).toEqual({ tipo: "pessoa", canal: "direto" });
  });

  it("só o modo (sem destino): a decisão é do Sec-Fetch, não do user-agent -> não é entrada", () => {
    expect(
      entrada(`${LOJA}/`, {
        "user-agent": UA_CHROME,
        accept: "text/html",
        "sec-fetch-mode": "navigate",
      }),
    ).toBeNull();
  });

  it("só o destino 'document' (sem modo): sem modo navigate não é navegação -> não é entrada", () => {
    expect(
      entrada(`${LOJA}/`, {
        "user-agent": UA_CHROME,
        accept: "text/html",
        "sec-fetch-dest": "document",
      }),
    ).toBeNull();
  });
});

describe("classificarEntrada — navegador antigo, sem Sec-Fetch: só 'Mozilla/' no COMEÇO e que pede HTML", () => {
  it("curl que cita 'Mozilla/' no meio do user-agent não é navegador", () => {
    expect(
      entrada(`${LOJA}/`, {
        "user-agent": "curl/8.0 (compatible; Mozilla/5.0)",
        accept: "text/html",
      }),
    ).toBeNull();
  });

  it("Accept em caixa mista ('Text/HTML') ainda é pedido de HTML", () => {
    expect(
      entrada(`${LOJA}/`, {
        "user-agent": UA_CHROME,
        accept: "Text/HTML,application/xhtml+xml",
      }),
    ).toEqual({ tipo: "pessoa", canal: "direto" });
  });

  it("Accept que só cita 'html' sem ser 'text/html' (application/xhtml+xml) não conta", () => {
    expect(
      entrada(`${LOJA}/`, {
        "user-agent": UA_CHROME,
        accept: "application/xhtml+xml",
      }),
    ).toBeNull();
  });
});

describe("classificarEntrada — de onde a pessoa veio", () => {
  const NAV = {
    "user-agent": UA_CHROME,
    "sec-fetch-mode": "navigate",
    "sec-fetch-dest": "document",
  };

  it("parâmetro de origem com espaços em volta ('  ig ') ainda vale", () => {
    expect(entrada(`${LOJA}/?utm_source=%20ig%20`, NAV)).toEqual({
      tipo: "pessoa",
      canal: "instagram",
    });
  });

  it("referer do Instagram com ponto final de FQDN ('instagram.com.') é Instagram", () => {
    expect(
      entrada(`${LOJA}/`, { ...NAV, referer: "https://instagram.com./p/abc" }),
    ).toEqual({ tipo: "pessoa", canal: "instagram" });
  });

  it("referer da própria loja com ponto final de FQDN no endereço da loja é 'direto'", () => {
    expect(
      entrada("https://loja-a.exemplo./", {
        ...NAV,
        referer: "https://loja-a.exemplo/produto",
      }),
    ).toEqual({ tipo: "pessoa", canal: "direto" });
  });

  it("user-agent que cita Instagram E WhatsApp: o Instagram vence", () => {
    expect(
      entrada(`${LOJA}/`, {
        ...NAV,
        "user-agent": `${UA_CHROME} Instagram 330.0 WhatsApp/2.23`,
      }),
    ).toEqual({ tipo: "pessoa", canal: "instagram" });
  });
});

describe("registrarEntrada — o log do silêncio sai uma vez por JANELA", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("duas falhas em voo: a segunda que chega EXATAMENTE no fim da janela da primeira também loga", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const conexao = {
      supabaseUrl: "https://projetoaaaaaaaaaaaaa.supabase.co",
      publishableKey: "sb_publishable_a",
    };
    const relogio = { agora: 0 };
    const silencio = new Map<string, number>();
    // Duas gravações começam juntas, com o banco ainda sem silêncio.
    const pendentes: Array<(r: Response) => void> = [];
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolver) => {
          pendentes.push(resolver);
        }),
    ) as unknown as typeof fetch;
    const deps = { fetchImpl, silencio, agora: () => relogio.agora };
    const a = registrarEntrada(conexao, "direto", deps);
    const b = registrarEntrada(conexao, "direto", deps);

    // A primeira volta com 500 em t=0: abre a janela de 60 s (até 60000).
    pendentes[0](new Response(null, { status: 500 }));
    await a;
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(silencio.get(conexao.supabaseUrl)).toBe(60_000);

    // A segunda volta com 500 EXATAMENTE quando a janela da primeira acaba.
    relogio.agora = 60_000;
    pendentes[1](new Response(null, { status: 500 }));
    await b;

    expect(aviso).toHaveBeenCalledTimes(2);
  });

  it("silêncio que VENCEU é apagado do mapa na hora de tentar de novo (o mapa não guarda banco curado)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const conexao = {
      supabaseUrl: "https://projetoaaaaaaaaaaaaa.supabase.co",
      publishableKey: "sb_publishable_a",
    };
    const silencio = new Map<string, number>([[conexao.supabaseUrl, 1_000]]);
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 204 }),
    ) as unknown as typeof fetch;

    // Relógio EXATAMENTE no fim da janela: já pode tentar.
    await registrarEntrada(conexao, "direto", {
      fetchImpl,
      silencio,
      agora: () => 1_000,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(silencio.has(conexao.supabaseUrl)).toBe(false);
  });
});
