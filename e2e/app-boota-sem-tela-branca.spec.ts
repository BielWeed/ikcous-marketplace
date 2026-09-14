import { expect, test } from "@playwright/test";

// Fumaça de boot DESLIGADA DE PROPÓSITO (test.fixme) — desligada com
// diagnóstico completo, não por falta de tempo. Prova o que o jsdom NÃO
// pega: o bundle compila, a suíte passa e o app não boota no navegador
// (a classe da tela branca do dev, laudo
// 20260909-laudo-opus-pr512-dev-tela-branca-react-lazy.md).
//
// POR QUE ESTÁ DESLIGADA (diagnóstico de 14/09, três runs locais medidos):
//   A página do build fixture NÃO boota num navegador limpo. A ordem de
//   resolução das chaves Supabase é FICHA primeiro (data block
//   `#ikcous-loja`, injetado no HTML pelo porteiro na borda), e só sem
//   ficha cai no `import.meta.env` (src/lib/env-valores.ts:51-63). O
//   `vite preview` serve HTML estático SEM porteiro, e o build fixture
//   RECUSA env por desenho (identityBuildConfig.ts:286-300,
//   "IDENTITY_FIXTURE: configuração real ou hospedagem recusada"). Resultado
//   medido: o EnvGuard (src/lib/env.ts) pinta a tela "🚨 ERRO DE AMBIENTE"
//   e lança — o app nem monta. A asserção de boot abaixo está escrita e
//   correta; falta o CAMINHO DE BOOT da página em CI.
//
// PLANO DE ATIVAÇÃO (peça futura pequena, coordenada pela central; vale
// para este spec E para o da folha, que precisa do app de pé com produto):
//   1. Injetar a ficha pelo lado do TESTE, sem tocar em produção —
//      `page.route` que devolve o HTML do preview com o data block
//      `<script type="application/json" id="ikcous-loja">` preenchido no
//      contrato de `src/config/fichaDaLojaContract.ts` (schemaVersion 2:
//      host, identidade com identityRevision sha256 — o serializador canônico
//      é src/hospedagem/ficha.ts —, conexao com URL
//      `https://<ref>.supabase.co` e chave `sb_publishable_…` FICTÍCIA de
//      formato válido, configuracao com os 4 campos). ALTERNATIVA: servir o
//      dist-test pelo servidor de ensaio da casa
//      (tests/porteiro-dois-hosts/servir.ts + host loja-c.localhost), que
//      já prova ficha no navegador — exige resolver a checagem de prontidão
//      (o porteiro responde 503 para host desconhecido; usar webServer.port,
//      que espera TCP, e não webServer.url, que espera 2xx).
//   2. Tirar ESTE `.fixme` e o da folha no MESMO PR de ativação (a folha
//      precisa de catálogo; ver e2e/folha-clique-fora-nao-atravessa.spec.ts).
//   3. Ligar os gatilhos do job e2e no workflow (hoje nasce
//      workflow_dispatch-only — custo recorrente zero até existir asserção
//      ativa; ver .github/workflows/ci-expansao.yml).
//
// O que este spec afirma quando ligar (escrito de uma vez, já revisado
// contra o código): HTTP 200; React montou no #root; o guardian de boot
// saiu do DOM (App chamou removeSilentGuardianLoader); a tela de erro de
// ambiente NÃO existe; nenhuma exceção sem captura na página — exceto a
// mensagem do EnvGuard VINDA DO SERVICE WORKER (o SW não tem `document`,
// não lê ficha e o portão lança dentro dele — src/lib/env.ts:115; filtrada
// abaixo por constante nomeada, com o porquê).
const ENV_GUARD_DO_SERVICE_WORKER = "[EnvGuard] Variáveis de ambiente ausentes";

test.fixme(
  "o app boota em navegador de verdade, sem tela branca",
  async ({ page }) => {
    const errosSemCaptura: string[] = [];
    page.on("pageerror", (erro) => {
      if (!erro.message.startsWith(ENV_GUARD_DO_SERVICE_WORKER)) {
        errosSemCaptura.push(erro.message);
      }
    });

    const resposta = await page.goto("/");
    expect(resposta?.status()).toBe(200);

    // O React assumiu o #root (o index.html estático só tem o guardian).
    await expect
      .poll(() => page.locator("#root > *").count(), { timeout: 30_000 })
      .toBeGreaterThan(0);

    // O boot terminou: o App chama removeSilentGuardianLoader quando os
    // dados assentam (src/main.tsx — a sincronização é do App.tsx).
    await expect(page.locator("#silent-guardian-loader")).toHaveCount(0, {
      timeout: 30_000,
    });

    // Fecho do falso-verde que o filtro acima poderia abrir: se o ambiente
    // quebrasse de verdade, o renderBootFailure (src/lib/env.ts) pinta esta
    // tela por cima — boot quebrado NUNCA pode passar aqui.
    await expect(page.getByText("ERRO DE AMBIENTE")).toHaveCount(0);

    // Tela branca é quase sempre um throw fora de qualquer boundary.
    expect(errosSemCaptura).toEqual([]);
  },
);
