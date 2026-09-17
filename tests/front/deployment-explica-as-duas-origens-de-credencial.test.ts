// A §5.2 do DEPLOYMENT.md é a folha que o operador lê ANTES de publicar as
// functions — e a partir da frente "mp" (15/09/2026) ela deixou de ser uma
// lista de secrets: agora existem DUAS origens para a credencial do Mercado
// Pago (a chave do LOJISTA, cifrada, e o MP_ACCESS_TOKEN da PLATAFORMA) e um
// INTERRUPTOR na tela que acende o PIX para o cliente. Documentação errada
// aqui custa dinheiro de verdade: quem deixa o cofre (MP_CHAVES_ENCRYPTION_KEY)
// de fora do deploy derruba a cobrança da loja que já cadastrou chave, e quem
// não sabe do interruptor entrega uma loja com chave salva e checkout sem PIX.
//
// Este teste ANCORA o texto no CÓDIGO: cada afirmação cobrada abaixo é lida
// primeiro no fonte (as functions importam mesmo `resolverCredenciaisMp`? a
// edge tem mesmo as ações `ligar_pix`/`desligar_pix`?) e só então cobrada do
// documento. Se a implementação sumir, a âncora cai junto e o teste diz qual
// das duas metades mentiu — é a mesma costura de
// `tests/front/recusa-do-pedido-ancora-nas-migrations.test.ts`.
//
// `import.meta.glob(..., '?raw')` em vez de `node:fs`: `tsconfig.app.json`
// cobre `tests/front` sem os tipos de Node, e `readFileSync` com caminho de
// variável acorda `security/detect-non-literal-fs-filename` — warning NOVO
// reprova o CI igual a erro (ver o cabeçalho do teste citado acima).
import { describe, expect, it } from "vitest";

const DOCUMENTOS = import.meta.glob<string>("/DEPLOYMENT.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

const FONTES = import.meta.glob<string>(
  "/supabase/functions/{_shared/credenciais-mp.ts,criar-pagamento/index.ts,webhook-mercadopago/index.ts,reconciliar-pagamentos/index.ts,estornar-pagamento/index.ts,credenciais-mercado-pago/index.ts}",
  { query: "?raw", import: "default", eager: true },
);

/** A folha de deploy promete `verify_jwt` de cada function; quem decide é
 * este arquivo, então ele entra como âncora e não como memória. */
const CONFIG = import.meta.glob<string>("/supabase/config.toml", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** A §5.2.1 manda o operador procurar um interruptor PELO RÓTULO. Rótulo é
 * texto de tela: se uma rodada futura renomear o Switch, a instrução vira
 * caça ao fantasma. Por isso a tela entra como âncora do rótulo. */
const TELAS = import.meta.glob<string>(
  "/src/components/admin/settings/MercadoPagoSection.tsx",
  { query: "?raw", import: "default", eager: true },
);

const DEPLOYMENT = DOCUMENTOS["/DEPLOYMENT.md"] ?? "";

function fonte(caminho: string): string {
  return FONTES[`/supabase/functions/${caminho}`] ?? "";
}

/** O trecho entre o cabeçalho da 5.2 e o da 5.3 — cobrar o arquivo inteiro
 * deixaria a 5.1 (que já fala de credencial) responder pela 5.2. */
function secao52(): string {
  const inicio = DEPLOYMENT.indexOf("### 5.2");
  const fim = DEPLOYMENT.indexOf("### 5.3", inicio + 1);
  expect(inicio, "DEPLOYMENT.md perdeu o cabeçalho da §5.2").toBeGreaterThan(
    -1,
  );
  expect(fim, "DEPLOYMENT.md perdeu o cabeçalho da §5.3").toBeGreaterThan(
    inicio,
  );
  return DEPLOYMENT.slice(inicio, fim);
}

/** O trecho da 5.3 até a 5.3.1: a folha de comandos propriamente dita. */
function secao53(): string {
  const inicio = DEPLOYMENT.indexOf("### 5.3 ");
  const fim = DEPLOYMENT.indexOf("### 5.3.1", inicio + 1);
  expect(inicio, "DEPLOYMENT.md perdeu o cabeçalho da §5.3").toBeGreaterThan(
    -1,
  );
  expect(fim, "DEPLOYMENT.md perdeu o cabeçalho da §5.3.1").toBeGreaterThan(
    inicio,
  );
  return DEPLOYMENT.slice(inicio, fim);
}

describe("DEPLOYMENT.md §5.2 conta as duas origens da credencial do Mercado Pago", () => {
  it("as quatro functions de dinheiro resolvem a credencial pelo módulo compartilhado (âncora)", () => {
    for (const caminho of [
      "criar-pagamento/index.ts",
      "webhook-mercadopago/index.ts",
      "reconciliar-pagamentos/index.ts",
      "estornar-pagamento/index.ts",
    ]) {
      expect(
        fonte(caminho),
        `${caminho} deveria importar resolverCredenciaisMp`,
      ).toContain("resolverCredenciaisMp");
    }
    // O cofre e a falha fechada são do módulo compartilhado, não das functions.
    expect(fonte("_shared/credenciais-mp.ts")).toContain(
      "MP_CHAVES_ENCRYPTION_KEY",
    );
    expect(fonte("_shared/credenciais-mp.ts")).toContain(
      'origem: "indisponivel"',
    );
  });

  it("nomeia o cofre MP_CHAVES_ENCRYPTION_KEY, que antes não aparecia em documento nenhum", () => {
    expect(secao52()).toContain("MP_CHAVES_ENCRYPTION_KEY");
  });

  it("diz que MP_ACCESS_TOKEN e MP_WEBHOOK_SECRET viraram RESERVA", () => {
    const texto = secao52();
    for (const variavel of ["MP_ACCESS_TOKEN", "MP_WEBHOOK_SECRET"]) {
      const linha = texto
        .split("\n")
        .find((l) => l.includes(`\`${variavel}\``) && l.includes("|"));
      expect(
        linha,
        `a linha de ${variavel} sumiu da tabela da §5.2`,
      ).toBeTruthy();
      expect(
        linha?.toLowerCase(),
        `${variavel} ainda é descrita como única origem`,
      ).toContain("reserva");
    }
  });

  it("explica a falha fechada: com chave do lojista cadastrada, sem cofre ninguém cobra", () => {
    const texto = secao52().toLowerCase();
    expect(texto).toContain("falha fechada");
    // A regra que a frente existe para impedir: cair no token da plataforma.
    expect(texto).toContain("conta errada");
  });

  it("ensina o interruptor do PIX e onde ele fica", () => {
    // Âncora: as ações existem mesmo na edge que a tela chama.
    const edge = fonte("credenciais-mercado-pago/index.ts");
    expect(edge).toContain('body.acao === "ligar_pix"');
    expect(edge).toContain('body.acao === "desligar_pix"');

    // Âncora do RÓTULO: a §5.2.1 manda tocar num interruptor com este nome.
    const tela =
      TELAS["/src/components/admin/settings/MercadoPagoSection.tsx"] ?? "";
    expect(tela, "MercadoPagoSection perdeu o rótulo do interruptor").toContain(
      "Receber PIX no app",
    );

    const texto = secao52();
    expect(texto).toContain("Ajustes > Pagamentos > Mercado Pago");
    expect(texto).toContain("Receber PIX no app");
  });

  it("avisa que pagamento_online e mp_public_key são escritas pela própria edge, com service role", () => {
    // Âncora: é a edge — e não uma migration ou o front — quem escreve as duas.
    const edge = fonte("credenciais-mercado-pago/index.ts");
    expect(edge).toContain("pagamento_online");
    expect(edge).toContain("mp_public_key");

    const texto = secao52();
    expect(texto).toContain("pagamento_online");
    expect(texto).toContain("mp_public_key");
    expect(texto.toLowerCase()).toContain("service role");
    expect(texto).toContain("credenciais-mercado-pago");
  });
});

describe("DEPLOYMENT.md §5.3 não manda publicar meia cobrança", () => {
  it("as cinco functions da cobrança aparecem na folha de deploy", () => {
    // Âncora: as duas que faltavam na folha existem mesmo e têm
    // `verify_jwt = true` no config.toml — por isso o comando delas vai SEM
    // `--no-verify-jwt`. (Não são as únicas do arquivo com a flag ligada;
    // aqui só interessam estas duas.)
    const config = CONFIG["/supabase/config.toml"] ?? "";
    for (const nome of ["estornar-pagamento", "credenciais-mercado-pago"]) {
      expect(config, `config.toml perdeu ${nome}`).toContain(
        `[functions."${nome}"]\nverify_jwt = true`,
      );
    }

    const texto = secao53();
    for (const nome of [
      "criar-pagamento",
      "webhook-mercadopago",
      "reconciliar-pagamentos",
      "estornar-pagamento",
      "credenciais-mercado-pago",
    ]) {
      expect(texto, `a §5.3 não manda publicar ${nome}`).toContain(
        `supabase functions deploy ${nome}`,
      );
    }
    // O título dizia "três functions": operador que confia nele publica três.
    expect(texto.slice(0, texto.indexOf("\n"))).not.toContain("três functions");
  });

  it("avisa que mexer no módulo compartilhado obriga a republicar as cinco", () => {
    // Âncora: o módulo é mesmo compartilhado pelas CINCO — as quatro que
    // cobram e a tela que GRAVA o segredo com as mesmas primitivas de cifra.
    // Cada deploy leva uma cópia do bundle; publicar quatro e esquecer a
    // quinta é a tela gravando por uma cifra enquanto as outras leem por
    // outra — o mesmo estrago com o sinal trocado.
    for (const caminho of [
      "criar-pagamento/index.ts",
      "webhook-mercadopago/index.ts",
      "reconciliar-pagamentos/index.ts",
      "estornar-pagamento/index.ts",
      "credenciais-mercado-pago/index.ts",
    ]) {
      expect(fonte(caminho)).toContain("credenciais-mp.ts");
    }

    const texto = secao53();
    expect(texto).toContain("_shared/credenciais-mp.ts");
    expect(texto.toLowerCase()).toContain("as cinco");
    // "as quatro" no parágrafo é a contagem velha: manda publicar meia cifra.
    expect(texto.toLowerCase()).not.toContain("as quatro");
  });
});
