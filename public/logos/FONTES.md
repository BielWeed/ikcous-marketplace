# Fontes dos logos oficiais (transportadoras e provedores de frete)

Todos os arquivos abaixo foram baixados diretamente do site oficial de cada
marca em **23/09/2026**, sem passar por banco de logo de terceiros (nada de
Wikipedia/seeklogo). Onde a proteção do site bloqueava `curl`, o arquivo foi
baixado com o navegador (Claude Browser) abrindo a própria página oficial e
lendo o asset que ela serve — a URL de origem de cada arquivo está listada
abaixo.

Nenhum SVG contém `<script>`, atributo `on*=`, `<foreignObject>` ou
referência externa (`xlink:href`/`href` para outro domínio) — conferido por
inspeção de texto em cada arquivo antes de entrar no repositório.

## Transportadoras (`public/logos/transportadoras/`)

| Arquivo | Marca | URL oficial exata | SHA-256 | Tamanho | Observação |
|---|---|---|---|---|---|
| `correios.svg` | Correios | `https://www.correios.com.br/++theme++tema-do-portal-correios/static/imagens/correios.svg` | `71b17f5b58e6bf946b20e2487c9172282bc08815ed8f1f785026b0c507167105` | 5329 B | Logo do header do site oficial (`alt="Imagem com o logo dos Correios"`). |
| `jadlog.png` | Jadlog | `https://www.jadlog.com.br/jadlog/img/logo_home.png` | `59b5d460e7fdde8a1048a6126f8ff73c0e01caffc7471b69b8741f7e644a21bd` | 2298 B | Logo do header (desktop) do site oficial, 450×80. |
| `loggi.svg` | Loggi | inline no `<header>` de `https://www.loggi.com/` (`a[href="/"] svg`, viewBox `0 0 131 44`) | `b56566042b80b9b6fd0c01dfbb13d8265eabd5662115068d5dbf990928b2a466` | 4987 B | Marca+wordmark oficiais, extraídos do próprio HTML do header. Usa `fill="currentColor"` (o site original o desenha branco sobre fundo escuro) — herda a cor de texto do componente que o envolve; o badge de `LogoDaTransportadora` usa fundo claro, então ele renderiza escuro/legível. |
| `jt-express.png` | J&T Express | data URI já embutido no HTML de `https://www.jtexpress.com.br/` (`img[alt="J&T Express"]`, 251×53) | `b14a4e7c68a28e357356b3e0186de5d21cd5757ddac760214138b09e16995788` | 1506 B | Logo do header, servido pelo próprio site como base64 inline. |
| `total-express.svg` | Total Express | `https://www.totalexpress.com.br/sites/default/files/images/logo.svg` | `dad8122013a81d6220f4e8baf11d12d1ed6022d42ed61fd520a3712ad07883de` | 11607 B | Logo do header (`alt="Total Express"`). |
| `latam-cargo.svg` | LATAM Cargo | `https://www.latamcargo.com/pt/images/logo_footer.svg` | `82ce97f3a4f850b83463803e3857dd46dff48a6cec36696e9bb54b8f34145f21` | 3802 B | Logo do rodapé do site oficial (`class="img-fluid footer-logo"`). |
| `azul-cargo.svg` | Azul Cargo Express | `https://www.azullogistica.com.br/Images/logos/logoDesktop.svg` | `12a7e31bc77bec5938513bd26e7f1acbe329113ca3125166b7d5dd516055931a` | 7226 B | **`azulcargoexpress.com.br` redireciona para `azullogistica.com.br`** — a marca foi renomeada de "Azul Cargo Express" para "Azul Logística" em 02/05/2026 (achado durante a pesquisa, não pedido pela tarefa). O arquivo é o logo OFICIAL atual da mesma empresa/CNPJ. O normalizador (`src/lib/marca-do-frete.ts`) continua reconhecendo o texto "Azul Cargo"/"Azul Cargo Express" porque é isso que a edge `calculate-shipping` manda hoje — decidir se o nome de exibição muda para "Azul Logística" é decisão de produto, fica para quem revisar. Parte do texto do logo é branca (`fill="white"`) — pode perder contraste num fundo muito claro; funciona no badge com fundo neutro do componente, mas vale checar visualmente. |
| `buslog.png` | Buslog | `https://buslog.com.br/favicon.ico` (servido como PNG) | `bbf94a21f2412435740d0822f5c10c4360ea90d5ea0036ea3b8225626f37ef38` | 754 B | **Resolução baixa (32×32).** O logo grande do header (`LOGOBuslog_comNovasMarcas_branco_verde_1-300x150.png`, ~10 KB) é branco+verde sobre fundo transparente — ilegível num card de fundo claro — e a tentativa de baixá-lo por `fetch`+base64 corrompeu no meio da transcrição (falha de transporte, não da fonte); em vez de arriscar um arquivo corrompido no repositório, optei pelo favicon oficial, que é pequeno mas íntegro e verificado (abre como PNG válido). Se quiser o logo grande, ele precisa ser buscado de novo com um método que não passe pela transcrição manual (ex.: baixar num passo à parte e revisar o arquivo antes de commitar). |

## Provedores/agregadores (`public/logos/provedores/`)

| Arquivo | Marca | URL oficial exata | SHA-256 | Tamanho | Observação |
|---|---|---|---|---|---|
| `melhor-envio.png` | Melhor Envio | `https://melhorenvio.com.br/apple-touch-icon.png` | `6aa908ed9403c4f8620ad0d73bdbad501a6a0b2132add2a50445c15434fc056d` | 6955 B | Ícone oficial em alta resolução (192×192) do próprio domínio. |
| `frenet.svg` | Frenet | `https://frenet.com.br/wp-content/uploads/2025/10/frenet-logo-rebrading.svg` | `b27048f77dc7c272ed81980e82db89b9e1b9d801fb164a09e5f07cbf9ea246d9` | 8318 B | Logo do rebranding atual da Frenet (versão "limpa", sem arte de campanha promocional — a home tem uma variante de campanha "Black do Frete" que não é o logo permanente da marca). |
| `superfrete.png` | SuperFrete | `https://superfrete.com/favicon.ico` (servido como PNG) | `4bb79bfb6709491e7616d185a3fb31763e2bea7020fbf2b523bae930f98e256e` | 3437 B | Ícone oficial (140×141) do próprio domínio. |

## Sem logo

Nenhuma marca do escopo ficou sem logo — todas as 8 transportadoras e os 3
provedores pedidos têm arquivo oficial verificável acima.

## Impacto em PWA/precache e no orçamento de tamanho

- `vite.config.ts` não redefine `publicDir` nem `assetsDir` (linha ~157: só
  `outDir`) — na configuração padrão do Vite, tudo em `public/` é copiado
  **verbatim para a raiz do `outDir`** (`dist/logos/...`), nunca para
  `dist/assets/`.
- `.size-limit.cjs` só mede `${output}/assets/*.js` e `${output}/assets/*.css`
  (mais o chunk isolado do leitor de código de barras). Como os logos não
  caem em `assets/`, **eles não contam para nenhum teto do `npm run size`**.
  Isto é lido diretamente da configuração; não rodei `npm run build` completo
  para confirmar por medição (o build em modo `fixture` desta máquina exige
  configuração de identidade que não faz parte do escopo desta tarefa) — se
  quiser o número medido em vez de deduzido, isso é um build a mais.
- `globPatterns` do Workbox (`vite.config.ts` linha 67) inclui
  `png,svg,webp` — os 11 arquivos SÃO pré-cacheados pelo service worker.
  Soma bruta (sem compressão) dos 11 arquivos: **56.219 bytes (~54,9 KB)**.
  Para efeito de comparação, é menos da metade do teto de UM único chunk CSS
  (100 KB) do `size-limit`, e ínfimo perto do teto de JS do boot (800 KB).
