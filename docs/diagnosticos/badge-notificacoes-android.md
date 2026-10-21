# Badge das notificações Android — 2026-10-21

## Entrega e limite

Correção local do build/SW/manifest, **sem deploy e sem banco**.
Não é prova de que o cabeçalho do grupo Android passou a mostrar a logo.

- O build deriva um PNG 96×96 branco/alpha do icon_192 verificado da própria
  identidade, publica por hash e expõe localUrls.badge_96 (opcional).
- O manifest assado referencia esse derivado com purpose: monochrome.
- O SW mantém icon como antes, mas badge só vem de badge_96 ou da reserva
  neutra /icons/badge-96x96.png. A ficha precisa pertencer ao hostname do SW.
- Ficha antiga, cache ausente/com erro, host diferente ou aviso textual inválido:
  badge neutro, nunca icon_192 colorido nem marca assada de outra loja.
- O porteiro inclui monochrome no manifest servido; sem badge na ficha, usa
  somente o neutro, **não** o derivado de alguma loja presente no build.

**Pendência real:** montarFicha em src/hospedagem/porteiro.ts usa identity.urls
vindas do Storage. O contrato atual de branding_assets não tem badge e seus
papéis são estritos. O derivado local do build não é automaticamente um arquivo
da identidade remota de cada host. Não alterei esse contrato, upload ou painel,
conforme o limite do despacho. Assim, a ficha pública atual continuará usando a
reserva neutra se só esta mudança for publicada.

Recomendação para uma etapa separada: aprovar um derivado opcional no pipeline
de upload/identidade, publicado no Storage da própria loja e transportado pela
ficha. Melhora: logo correta em vez de neutro para cada loja. Risco: mudar o
contrato de identidade pode invalidar identidades antigas. Reversão: manter o
campo opcional e conservar o fallback atual; remover a leitura do novo papel
não apaga dados. Bem maior: não interromper identidades existentes nem misturar
marcas. Nenhuma migration foi necessária ou executada aqui; não afirmei que a
etapa futura exige uma coluna nova.

## Pesquisa: o que é garantido e o que não é

Fontes consultadas em 2026-10-21:

1. [MDN: Notification.badge](https://developer.mozilla.org/en-US/docs/Web/API/Notification/badge)
   e [showNotification](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification):
   imagem pequena para locais como barra de status; no Android, acomodar até
   4× a resolução (cerca de 96×96), mascarada como silhueta monocromática.
2. [web.dev: Displaying a Notification](https://web.dev/articles/push-notifications-display-a-notification):
   badge separado de icon, 24 px × densidade; o texto antigo usa 3×/72 px.
   Adotado 4×/96 px da MDN, não 72 como teto.
3. [W3C Web App Manifest: purpose](https://www.w3.org/TR/appmanifest/#purpose-member):
   monochrome descarta RGB e usa alpha; o navegador escolhe a cor. Logo branca
   com fundo transparente é uma representação apropriada; branco não é uma
   exigência de cor final, porque o sistema pode tingir a máscara.
4. [Chromium atual: NotificationPlatformBridge](https://chromium.googlesource.com/chromium/src/+/main/chrome/android/java/src/org/chromium/chrome/browser/notifications/NotificationPlatformBridge.java):
   badge alimenta setStatusBarIcon e setSmallIconForContent; há ic_chrome como
   recurso padrão.
5. [Chromium atual: WebApkServiceClient](https://chromium.googlesource.com/chromium/src/+/main/chrome/android/java/src/org/chromium/chrome/browser/webapps/WebApkServiceClient.java):
   fallbackToWebApkIconIfNecessary só usa o recurso do WebAPK quando falta o
   bitmap correspondente. Portanto, um badge fornecido não é simplesmente
   substituído pelo manifest em toda notificação.
6. [Correção Chromium do bug 867351](https://chromium.googlesource.com/chromium/src/+/21447c9d90951d0bded1a7a0c2ae29389d50b6eb):
   documenta exatamente uma regressão em que WebApkServiceClient sobrescrevia
   o bitmap pequeno; a correção preservou o badge fornecido no Android M+.
   [Discussão histórica de icon purposes](https://groups.google.com/a/chromium.org/g/blink-dev/c/1ebMBNhqRew/m/_6hAQKAfBwAJ):
   distingue recurso do APK nos Android antigos e Notification.badge no M+.
7. [Android: grupos de notificações](https://developer.android.com/develop/ui/views/notifications/group):
   o resumo do grupo é uma notificação própria, com smallIcon próprio nos
   exemplos; o agrupamento automático pode variar conforme o aparelho.
8. [Chromium atual: WebAPK update fetcher](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/android/webapk/webapk_update_data_fetcher.cc):
   a implementação consultada trata ícones primário/splash e maskable; não
   estabelece a alegada regra universal de usar manifest monochrome no grupo.

**Conclusão precisa:** badge é o controle web explícito da imagem pequena de
cada aviso Android. Ausência/falha leva ao recurso padrão do navegador/WebAPK;
uma imagem opaca também pode simplesmente virar bloco/disco, não há regra de
que ela obrigatoriamente produza o glifo genérico. O manifest declara a
intenção monochrome, mas a especificação não promete que ele controla o
cabeçalho de um grupo do Android. Não foi possível confirmar essa promessa para
o Chrome/aparelho da captura; só teste físico da versão instalada resolve isso.
Não confundir Notification.badge com a Badging API (contador no ícone do app).

Relatos além das fontes oficiais, julgados pela evidência:

- [MailFlow PR 447](https://github.com/maathimself/mailflow/pull/447): descreve
  badge colorido com fundo cobrindo ~95%, virando retângulo branco. Testes
  passam, mas não há prova física Android no relato consultado.
- [Compose Preview Server PR 1319](https://github.com/yschimke/compose-preview-server/pull/1319):
  relata disco branco e fornece prévias simuladas; declara WebAPK monochrome
  não verificado no aparelho. Não serve para prometer correção do grupo.
- [Univik: PWA Android icons](https://univik.com/blog/pwa-android-icons.html):
  menciona monochrome para badges, mas não apresenta teste de compatibilidade
  ou captura. Evidência fraca, usada só como relato, não como autoridade.

## Medição pública, sem autenticação

GET em https://ickous-marketplace.vercel.app:

```text
/                     200 text/html; charset=utf-8
manifest link: <link rel="manifest" href="/manifest.webmanifest">
/manifest.webmanifest 200 application/manifest+json; charset=utf-8
/identidade.json      200 application/json; charset=utf-8
host: ickous-marketplace.vercel.app
manifest name: IKCOUS - imports
icons: 192x192 (sem purpose), 512x512 (sem purpose), 512x512 maskable
monochrome: ausente
badge_96: ausente
```

icon_192 público:
https://cafkrminfnokvgjqtkle.supabase.co/storage/v1/object/public/branding/v1/46437c44be9406790a010c1a14dc2f795d64782560419676132cb3e0c0493843/icon-192x192.png

```text
status=200 content-type=image/png bytes=3475
width=192 height=192 hasAlpha=true
alphaMin=0 alphaMax=255
pixelsNotOpaque=1813 totalPixels=36864
```

Logo, **não é totalmente opaco/sem alpha**, ao contrário da hipótese inicial.
35.051 pixels (~95,08%) são totalmente opacos. O código anterior passa
exatamente essa URL como icon E badge. A regra nova, aplicada em memória aos
bytes públicos, conseguiu derivar:

```text
PNG 96x96, hasAlpha=true, bytes=868
visiblePixels=687 totalPixels=9216
```

Isso prova extração de pixels, não aparência de uma notificação no Android.

## Regra de derivação e seus limites

Só entra o PNG icon_192 já verificado no preparo; nunca se renderiza SVG remoto
ou se lê outro arquivo/loja para fabricar a marca.

- Perímetro inteiramente transparente: mantém o canal alpha original.
- Caso contrário: exige amostra opaca e cor uniforme em TODO o perímetro
  visível (tolerância máxima 8/255 por canal RGB). Remove apenas pixels dessa
  cor conectados ao perímetro, incluindo cantos transparentes.
- Regiões fechadas da mesma cor do fundo permanecem na silhueta. Não tenta
  reconstruir traços apagados, separar cores sobrepostas ou interpretar fotos.
- Fundo não uniforme, contorno ambíguo ou imagem vazia: reserva neutra.
- Reduz a máscara a 96×96 e fixa RGB branco depois da redução para evitar
  arredondamento 254/255 no RGB premultiplicado. Alpha conserva a antialias.

A reserva é um sino neutro, não a marca de nenhuma loja. Não está em
retiredPaths; o teste de preparo compara os bytes copiados. Os caminhos
icon-192x192/icon-512x512/icon-maskable antigos continuam aposentados.

## Verificação observada

TDD: antes da implementação, os testes de SW/manifest falharam com badge
colorido no lugar do derivado/reserva (8 falhas). Os testes do pipeline
falharam por badge_96 ausente e PNG de reserva inexistente (5 falhas).
O caso de texto inválido também foi observado vermelho antes de adicionar a
reserva nesse ramo.

Comando final de testes escopados:

```text
npx vitest run tests/front/prepare-identity-build.test.ts tests/front/sw-identidade-notificacao.test.ts tests/front/sw-icone-neutro-nunca-o-da-principal.test.ts tests/front/sw-identidade-fora-do-document.test.ts tests/front/porteiro-fluxo.test.ts tests/front/identity-build-config.test.ts tests/front/identity-build-integration.test.ts --silent

Test Files  7 passed (7)
     Tests  152 passed (152)
```

Após reforçar o ensaio integrado com uma logo transparente em uma loja e a
reserva na outra:

```text
npx vitest run tests/front/identity-build-integration.test.ts --silent
Test Files  1 passed (1)
     Tests  7 passed (7)
```

ESLint escopado nos TypeScript alterados: exit 0, sem saída, sem avisos novos.
Uma execução inicial encontrou 3 avisos de índices de pixels nos testes;
foram limitados e documentados como offsets de RGBA, com ESLint final limpo.
Uma checagem tsc inicial encontrou string | undefined no teste; corrigida
por guarda explícita. O build final a seguir inclui tsc e passou.

Build completo do app: **uma única execução**, com fixture e NODE_ENV=production:

```text
IKCOUS_IDENTITY_MODE=fixture NODE_ENV=production npm run build
BUILD_EXIT=0
✓ built in 31.50s
Building src/sw/sw.ts service worker ("es" format)...
✓ 4 modules transformed.
dist-test/sw.mjs  10.25 kB
✓ built in 184ms
precache 144 entries (4103.70 KiB)
files generated
  dist-test/sw.js
```

A fixture padrão tem ícone de cor sólida: o manifest corretamente aponta para
a reserva. O ensaio de integração separado também provou derivado por hash,
arquivo existente e entrada no precache para uma identidade com silhueta.

```text
manifestMonochrome:
  src=/icons/badge-96x96.png sizes=96x96 type=image/png purpose=monochrome
dist-test/icons/badge-96x96.png:
  bytes=786 width=96 height=96 hasAlpha=true
  alphaMin=0 alphaMax=255 nonWhiteVisiblePixels=0
fallbackPrecached=true
swBytes=19999
retiredIconPresent=false
```

A primeira sonda de precache procurou uma chave JS sem aspas (url:) e retornou
false; o artefato usa JSON com "url":. Conferência do trecho e nova sonda com
esse literal real confirmaram true. Não houve alteração nem novo build.

```text
IKCOUS_IDENTITY_MODE=fixture npm run size
cliente 545.82 / 552 kB
painel  463.81 / 472 kB
CSS      44.48 / 100 kB
zxing   334.87 / 400 kB
exit 0
```

.size-limit.cjs lê assets/*.js, CSS e leitor/WASM: **não inclui sw.js nem
ícones PNG**. Não foi editado.

Comparação isolada via esbuild, mesma configuração e sem lista de precache,
com fonte da base 88623aaf e fonte atual:

```text
base:  bundleBytes=10010 brotliBytes=3431
atual: bundleBytes=10116 brotliBytes=3451
delta: +106 bytes brutos / +20 bytes brotli
reserva PNG: +786 bytes
```

Essa comparação não é uma segunda compilação completa nem uma estimativa da
diferença de todos os chunks. Sem segundo build completo da base, não alego
delta do pacote inteiro.

Avisos observados: Node --localstorage-file sem caminho válido nos ensaios;
aviso do Vite sobre chunk >500 kB (vendor-inicio). Os limites reais acima
passaram. Suítes gerais, CI, teste físico Android, instalação/atualização do
WebAPK e comportamento do grupo **não foram executados**. Nenhum login,
consulta autenticada, migration, upload ou deploy.
