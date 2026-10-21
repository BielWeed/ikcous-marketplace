# Peça 2 — verificação do painel de banners (21/10/2026)

## Estado da entrega

Implementação funcional commitável, mas **não satisfaz ainda a restrição de crescimento zero da loja**. Não publicar como peça integralmente aprovada.

## Peso medido (brotli)

Base: `2cb350b9b0c783d627cba294ae6a9b1176d975a0` + peça 3 `7e694c42b589faa3ff63415be25b30e7b0f9eb79`.

| Pacote | Antes | Depois | Delta | Teto |
| --- | ---: | ---: | ---: | ---: |
| Loja | 551.489 B | 551.539 B | **+50 B — bloqueia o contrato** | 552.000 B |
| Painel | 465.034 B | 461.317 B | −3.717 B | 472.000 B |
| CSS | 45.327 B | 44.578 B | −749 B | 100.000 B |
| Leitor | 334.871 B | 334.871 B | 0 B | 400.000 B |

Comandos reais:
```text
IKCOUS_IDENTITY_MODE=fixture NODE_ENV=production npm run build
✓ built in 32.12s
[exited with code 0]

IKCOUS_IDENTITY_MODE=fixture npx size-limit --json
loja: passed=true, size=551539, sizeLimit=552000
painel: passed=true, size=461317, sizeLimit=472000
CSS: passed=true, size=44578, sizeLimit=100000
leitor: passed=true, size=334871, sizeLimit=400000
```

O size-limit passa, mas isso NÃO prova crescimento zero. Inicialmente as paletas/descrições do editor caíram no chunk público (+262 B); elas e o construtor do tipo foram separados, mantendo os exports do contrato. A busca por "Produto à direita", "Grafite", "Desconto em letras grandes" no build final encontra apenas `AdminBannersView-WJiCoS_b.js`. A experiência com import dinâmico dos desenhos aumentou o pacote público e foi desfeita. Restam os 50 B de diferença na divisão/compressão dos chunks compartilhados; não alterei o teto nem compensei com código alheio à peça.

## Tipos e lint

```text
npx tsc -p tsconfig.app.json --noEmit
[exited with code 0]

npx biome check <27 arquivos da peça>
Checked 27 files in 110ms. No fixes applied.

node scripts/lint-ratchet.mjs
ferramenta tipo       agora      teto       situação
eslint     errors     0          0          ok
eslint     warnings   292        405        baixou -113
biome      errors     13         13         ok
biome      warnings   1          1          ok
[exited with code 0]

git diff --check
[sem saída; exit 0]
```

Biome direto executado nestes arquivos:
- `src/views/admin/AdminBannersView.tsx`
- `src/components/admin/banners/CamposDeTextoDoBanner.tsx`
- `src/components/admin/banners/EscolherCriacaoDoBanner.tsx`
- `src/components/admin/banners/GaleriaDeBanners.tsx`
- `src/components/admin/banners/PreviaImagemPropria.tsx`
- `tests/front/admin-banners-modelos-fluxo.test.tsx`
- `tests/front/helpers/editor-de-banner.ts`
- `tests/front/admin-banners-destino-nasce-vivo.test.tsx`
- `tests/front/admin-banners-duplicar-removido-nao-apaga-imagem-alheia.test.tsx`
- `tests/front/admin-banners-envio-preserva-rascunho.test.tsx`
- `tests/front/admin-banners-esc-fecha-so-o-cropper.test.tsx`
- `tests/front/admin-banners-preco-do-produto-com-virgula.test.tsx`
- `tests/front/admin-banners-recorte-salva-o-tipo-real-da-imagem.test.tsx`
- `tests/front/admin-banners-salvar-durante-recorte.test.tsx`
- `tests/front/admin-banners-salvo-falho-nao-deixa-upload-orfao.test.tsx`
- `tests/front/admin-banners-upload-durante-salvar.test.tsx`
- `tests/front/admin-banners-upload-orfao-e-input.test.tsx`
- `tests/front/banner-datas-sem-sentido.test.tsx`
- `tests/front/banner-link-digitado-sem-https.test.tsx`
- `tests/front/banner-link-so-http-e-caminho.test.tsx`
- `tests/front/banners-modo-lembrado.test.tsx`
- `tests/front/admin-banners-voltar-fecha-so-o-dialogo.test.tsx`
- `tests/front/banner-upload-atrasado-apaga-o-arquivo-orfao.test.tsx`
- `tests/front/banners-letra-l.test.tsx`
- `src/lib/banner-modelos.ts`
- `src/lib/catalogo-de-banners.ts`
- `src/lib/prefixo-do-banner.ts`

## Testes — 40 arquivos, 564 testes, todos passando

Não rodei suíte inteira. Todos os lotes usam `vitest run`, no máximo 6 arquivos e um worker.
Há avisos de ambiente `--localstorage-file`, canvas ausente em jsdom e logs das falhas de rede simuladas; o teste não os escondeu. O teste preexistente `strategic-intelligence-error-banner` também emite aviso de `act`.

### Lote 1

```text
npx vitest run tests/front/use-banners-recarga-atrasada.test.tsx tests/front/preload-do-banner-pede-a-mesma-foto.test.tsx tests/front/push-banner-granted-sem-inscricao-nao-fica-escondido-para-sempre.test.tsx tests/front/push-banner-nao-cobre-o-produto-nem-convida-quem-nao-entrou.test.tsx tests/front/push-banner-nao-pisa-no-caminho-do-dinheiro.test.tsx tests/front/reordenar-banner-nao-muta-o-estado.test.tsx --maxWorkers=1
 Test Files  6 passed (6)
      Tests  40 passed (40)
   Duration  14.90s (transform 551ms, setup 140ms, import 3.68s, tests 601ms, environment 8.52s)
```

### Lote 2

```text
npx vitest run tests/front/reordenar-banner-numa-rpc-so.test.tsx tests/front/admin-banners-default-nao-diverge.test.tsx tests/front/admin-banners-ligar-desligar-falha-avisa.test.tsx tests/front/admin-banners-recorte-nao-troca-editor.test.tsx tests/front/strategic-intelligence-error-banner.test.tsx tests/front/banner-destino-do-link.test.tsx --maxWorkers=1
 Test Files  6 passed (6)
      Tests  53 passed (53)
   Duration  16.59s (transform 1.20s, setup 147ms, import 1.08s, tests 6.83s, environment 7.07s)
```

### Lote 3

```text
npx vitest run tests/front/banner-do-cache-nao-fica-empobrecido.test.ts tests/front/banner-imagem-sobe-reduzida.test.tsx tests/front/banner-legivel-e-que-para.test.tsx tests/front/banner-mutado-no-painel-aparece-no-proximo-mount.test.tsx tests/front/banner-upload-atrasado-nao-troca-a-imagem-de-outro.test.tsx tests/front/banners-cache-tardio.test.tsx --maxWorkers=1
 Test Files  6 passed (6)
      Tests  37 passed (37)
   Duration  9.98s (transform 963ms, setup 119ms, import 382ms, tests 2.94s, environment 5.44s)
```

### Lote 4

```text
npx vitest run tests/front/banner-modelos.test.ts tests/front/banner-pronto.test.tsx tests/front/criar-banner-com-ia.test.tsx tests/front/prompt-de-banner.test.ts tests/front/admin-banners-destino-nasce-vivo.test.tsx tests/front/admin-banners-duplicar-removido-nao-apaga-imagem-alheia.test.tsx --maxWorkers=1
 Test Files  6 passed (6)
      Tests  84 passed (84)
   Duration  11.55s (transform 763ms, setup 126ms, import 503ms, tests 5.96s, environment 3.83s)
```

### Lote 5

```text
npx vitest run tests/front/admin-banners-preco-do-produto-com-virgula.test.tsx tests/front/admin-banners-esc-fecha-so-o-cropper.test.tsx tests/front/admin-banners-envio-preserva-rascunho.test.tsx tests/front/admin-banners-recorte-salva-o-tipo-real-da-imagem.test.tsx tests/front/admin-banners-salvo-falho-nao-deixa-upload-orfao.test.tsx tests/front/admin-banners-upload-orfao-e-input.test.tsx --maxWorkers=1
 Test Files  6 passed (6)
      Tests  22 passed (22)
   Duration  16.83s (transform 931ms, setup 134ms, import 406ms, tests 9.40s, environment 5.76s)
```

### Lote 6

```text
npx vitest run tests/front/admin-banners-voltar-fecha-so-o-dialogo.test.tsx tests/front/admin-banners-salvar-durante-recorte.test.tsx tests/front/banners-modo-lembrado.test.tsx tests/front/banner-link-digitado-sem-https.test.tsx tests/front/banner-link-so-http-e-caminho.test.tsx tests/front/banner-datas-sem-sentido.test.tsx --maxWorkers=1
 Test Files  6 passed (6)
      Tests  300 passed (300)
   Duration  42.46s (transform 892ms, setup 139ms, import 522ms, tests 32.28s, environment 7.36s)
```

### Lote 7

```text
npx vitest run tests/front/admin-banners-upload-durante-salvar.test.tsx tests/front/banner-upload-atrasado-apaga-o-arquivo-orfao.test.tsx tests/front/banners-letra-l.test.tsx tests/front/admin-banners-modelos-fluxo.test.tsx --maxWorkers=1
 Test Files  4 passed (4)
      Tests  28 passed (28)
   Duration  14.30s (transform 758ms, setup 102ms, import 238ms, tests 10.45s, environment 2.78s)
```

## TDD novo

`tests/front/admin-banners-modelos-fluxo.test.tsx` teve vermelho observado: inicialmente faltavam "Modelo pronto" e editor de imagem própria; depois os testes de seletor compacto, upload recuperado e atalhos de botão falharam pelo comportamento ausente, antes da correção. Os 8 testes finais cobrem:
- modelo → produto → gravar tipo pronto_, primeira foto, productId/link, textos e cor Loja;
- busca de produto recolhida após escolher, com Trocar para reabrir;
- IA → upload existente → imagem própria;
- maxLength dos quatro campos;
- edição antiga preservando templateType e textos;
- recuperar/cancelar limpando só o upload não publicado;
- atalhos de botão e limpar;
- cancelar foto de produto sem excluir o cadastro.

## Ajustes intencionais nos testes antigos

A navegação mudou de Simples/Completo e três passos para escolha do jeito + Mais opções. O helper `tests/front/helpers/editor-de-banner.ts` percorre a nova navegação. As assertivas de dados, concorrência, datas, links, limpeza e histórico foram preservadas.

Arquivos com adaptação de navegação:
- `tests/front/admin-banners-destino-nasce-vivo.test.tsx`
- `tests/front/admin-banners-duplicar-removido-nao-apaga-imagem-alheia.test.tsx`
- `tests/front/admin-banners-envio-preserva-rascunho.test.tsx`
- `tests/front/admin-banners-esc-fecha-so-o-cropper.test.tsx`
- `tests/front/admin-banners-preco-do-produto-com-virgula.test.tsx`
- `tests/front/admin-banners-recorte-salva-o-tipo-real-da-imagem.test.tsx`
- `tests/front/admin-banners-salvar-durante-recorte.test.tsx`
- `tests/front/admin-banners-salvo-falho-nao-deixa-upload-orfao.test.tsx`
- `tests/front/admin-banners-upload-durante-salvar.test.tsx`
- `tests/front/admin-banners-upload-orfao-e-input.test.tsx`
- `tests/front/banner-datas-sem-sentido.test.tsx`
- `tests/front/banner-link-digitado-sem-https.test.tsx`
- `tests/front/banner-link-so-http-e-caminho.test.tsx`
- `tests/front/banners-modo-lembrado.test.tsx`
- `tests/front/admin-banners-voltar-fecha-so-o-dialogo.test.tsx`: acrescenta escolha de imagem própria.
- `tests/front/banner-upload-atrasado-apaga-o-arquivo-orfao.test.tsx`: durante upload, a prévia anterior agora continua visível; preserva as assertivas de bloqueio/limpeza.
- `tests/front/banners-letra-l.test.tsx`: a régua estática de 11 px cobre a view e os novos componentes. Saíram contagens exatas e marcadores dos celulares desenhados, layouts e badges antigos que não existem mais; prévias em escala ficam fora da régua do chrome.
- `admin-banners-destino-nasce-vivo`: seleção comprovada por aria-pressed em vez da classe roxa que saiu do redesenho.

## Inventário e limites

Tabela completa função → lugar: [banners-admin-inventario.md](banners-admin-inventario.md).

Não comprovado: aparência real em navegador, responsividade visual a 375 px, contraste efetivo dos três temas e movimento reduzido no navegador. Há classes/tokens e alvos de 44 px no código, mas jsdom não prova geometria. Não fiz login real, gravação remota, CI, deploy, migration ou alteração de `.size-limit.cjs`.

Skills: executar-tarefa (inventário/leitura/TDD/limites), superpowers:test-driven-development + writing-good-tests (vermelho real), vercel-react-best-practices via roteador (separação dos dados exclusivos do editor), run (não confundir teste isolado com app real), superpowers:verification-before-completion (explicitar a pendência de 50 B).
