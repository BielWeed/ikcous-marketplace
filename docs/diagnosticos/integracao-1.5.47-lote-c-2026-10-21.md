# Integração 1.5.47 — lote C — 2026-10-21

## Resultado

Branch `integracao-147-c`, criada na própria worktree a partir de `integracao-147-b` (`88623aaf`).
Dez merges na ordem autorizada, sem push, PR, migration aplicada ou deploy.

- Verificação local selecionada: **711 arquivos / 8.389 testes / 120 lotes**, todos verdes ao final.
- `npx tsc -b --force`: código 0, sem saída; uma execução explícita.
- Biome: 21 arquivos, sem erro ou correção pendente.
- ESLint: código 0, **0 erros / 21 avisos**; não se declara ausência de avisos.
- Deno: 545 testes de publicação + 9 testes das migrations de categorias/card de frete, todos verdes.
- Um único `npm run build` em fixture/production, seguido de um único `size-limit --json`.
- Loja: **548.023 B**, teto 552.000 B, **folga 3.977 B**.
- Painel: **469.494 B**, teto 472.000 B, **folga 2.506 B**.
- CSS: 46.295 B / 100.000 B. Leitor: 334.871 B / 400.000 B.
- Medição: soma Brotli por arquivo conforme o portão existente. `.size-limit.cjs` não foi alterado.
- O build mediu o conteúdo final do código antes deste commit de fechamento; só este relatório foi acrescentado depois. Fixture não é artefato promovível.

## Merges

| Branch | Origem efetivamente mesclada | Commit de merge |
| --- | --- | --- |
| banner-admin-146d | 9bf66ced | 583d6e4a |
| finalizar-146b | f4b2f36e | 844d7c3f |
| mototaxi-147 | 33fbb1e9 | af9b389f |
| categorias-icones-147 | 8c01f67c | 62d1c115 |
| vender-tela-cheia-147 | 8b712f24 | 5e01319d |
| devolucoes-botao-147 | 81ac5617 | caa0303f |
| ficha-cliente-147 | b702ddbf | 4bef3d6d |
| produto-redesenho-147 | 58e90962 | bd16dafc |
| minha-loja-salvar-unico-147 | 8729dd3f | 49ccb869 |
| badge-notificacao-147 | 74b461a9 | 6c71acf6 |

`frete-card-estilo-147b` entrou apenas como ancestral de `mototaxi-147`.
Não houve merge separado dessa branch, de `fix-relatorios-146b`, de `icone-whatsapp-146` ou de branches `worktree-agent-*`.

## Conflitos e resolução

1. **Banners** — `temas-do-painel-cores.css` regenerado pelo gerador do repositório; lista de cores inicialmente unida. As entradas que a varredura demonstrou inexistentes foram retiradas na conciliação posterior, sem retirar testes.
2. **Mototáxi / AdminShippingView** — houve parada por conflito de lógica. A decisão recebida foi aplicada: a base manda; mototáxi é o terceiro bloco independente.
   - `regrasMudaram = isFormDirtyLocal || isFormDirtyNacional`.
   - Pendência inclui regras, transportadoras e contato; a guarda de navegação continua incluindo os tokens de transportadoras.
   - Somente contato pendente dispensa as travas de frete; com frete/transportadora pendente, todas as travas da base permanecem.
   - Ordem: contato → regras → transportadoras. Falha do contato impede gravar frete; contato já confirmado não volta a pendente se o frete falha depois.
   - Sucesso de contato isolado nunca anuncia “Regras de frete salvas!”.
   - O fieldset de Mototáxi e “Tentar carregar de novo” ficaram **no fim do painel “Na sua região”, logo abaixo de FreteLocalBloco**.
   - Assinatura conferida: `useMototaxi(sinalDeReleitura?: boolean)`; uso `useMototaxi(active)`.
3. **Categorias / registros** — união aditiva em:
   - `.github/workflows/conferir-banco-da-loja.yml`
   - `.github/workflows/rpc-ci.yml`
   - `scripts/frota/canais-de-backend.json`
   - `scripts/frota/publicar-release.mjs`
   - `scripts/publicacao/conferir-banco.cjs`
   - `tests/frota_publicar_release_test.ts`
   
   Mantidos todos os róis e as consultas: **60 = frete, 61 = categorias, 62 = mototáxi**. No registro de lotes, versões ordenadas **20261300000000 < 20261310000000 < 20261330000000**.
4. **Vender / cobertura de temas** — retiradas apenas classes sem uso demonstrado pela varredura, incorporadas as correções já trazidas pela branch e regenerado o CSS.
5. Os demais merges foram automáticos. `database.types.ts` foi conferido como aditivo: categoria.icone, configuração privada do mototáxi/RPC e estilo do card nas formas de leitura/escrita.

## Correções e arquivos manuais

- `src/views/admin/AdminShippingView.tsx`: combinação autorizada dos três blocos; formatação final.
- `tests/front/admin-shipping-mototaxi.test.tsx`: abertura do painel pelo nome vigente e provas de falha do contato, falha posterior do frete e travas combinadas.
- `src/views/admin/AdminBannersView.tsx`: cabeçalho do editor usa AdminPageHeader; ícone de ajuda marcado decorativo sem perder nome acessível/alvo de toque.
- `tests/front/temas-do-painel-gerador.ts`: suporte à seleção aria-pressed, bordas/anéis dos controles novos e verde legível no tema Claro.
- `tests/front/temas-do-painel-cobertura.test.ts`: prova dos seletores/tokens novos e remoção de exceções obsoletas.
- `src/components/layouts/temas-do-painel-cores.css`: **somente regenerado**, nunca editado à mão.
- `tests/front/produtos-cabem-no-celular.test.tsx`: fixa a moldura neutra vigente e mantém a exigência de cor semântica no valor da margem.
- `tests/front/acess-onda2-contrato.test.tsx`: incorpora min-w-0 do campo de cupom, preservando todas as exigências de foco e fonte.
- `tests/front/admin-ajustes-salao-e-porao.test.tsx`: sexta porta, Card de frete grátis, e destinos preservados.
- `tests/front/ajuda-e-inicio-letra-e-toque.test.ts`: reconhece também o Button compartilhado; controles negativos preservados e ampliados.
- `tests/front/ajustes-grupos-e-portas.test.tsx`: atenção em âmbar, conforme a paleta da base.
- `tests/front/celular-estreito-rodape-contraste-toque.test.ts`: verifica a cor agora definida no CSS compartilhado do resumo; contraste continua exigindo 4,5:1.
- `tests/front/estoque-baixo-um-limiar.test.ts`: cor de atenção vigente; critérios de estoque e selo Crítico mantidos.
- `tests/front/financeiro-cartoes-no-desenho-novo.test.tsx`: cor negativa vigente; valores e comportamento não alterados.
- `tests/front/helpers-compartilhados-do-grafico.test.ts`: resolve o Recharts realmente instalado com createRequire, em vez de presumir node_modules dentro da worktree. Nenhuma alteração no plugin de produção.
- `tests/front/identity-build-finalization.test.ts`: 148 redirecionamentos e presença das quatro formas da rota nova do card.
- `tests/front/pedido-nota-e-rastreio-nao-se-perdem.test.tsx`: mock separa a consulta de config_mototaxi da fila de leituras das notas; não consome respostas das notas.
- `tests/front/vetos-de-atualizacao/banners.test.tsx`: percorre a nova etapa “Usar minha imagem” antes do upload; todas as exigências de veto permanecem.

### Falhas da base e contraste

As correções de `tema-do-painel.test.tsx` (seletor :where e token sem uso), a retirada de classes inexistentes e as exceções legítimas de vermelho/hover claro já vieram da branch Vender. Foram verificadas no conjunto.
O título manual de Banners foi corrigido no código; a expectativa antiga da borda do simulador foi alinhada ao desenho vigente sem apagar a prova da cor do valor.

Cálculo observado (WCAG, branco como fundo):

```text
BE123C sobre branco: 6.2852:1
25D366 sobre branco: 1.9833:1
166534 sobre branco: 7.1303:1
```

O vermelho sólido com texto branco fica em MANTIDAS por passar AA; o verde claro não ganhou exceção: recebeu tom escuro no Claro. Temas fixos continuam excluídos pelo seletor existente. Nenhuma checagem de contraste foi reduzida.

### Leitor compartilhado

Conferidos a interface atual e o uso de `LeitorDeCodigo` no formulário: import dinâmico, modo único, callbacks e overlay preservados.
Incluídos na seleção e aprovados os testes do leitor/componente/hook, `admin-product-form-ler-com-a-camera.test.tsx`, os testes do formulário e os da Vender.
Isso é prova local automatizada, **não teste de câmera física**.

## Verificações gerais — saídas

### Typecheck

`npx tsc -b --force`

```text
Código de saída: 0
Sem saída.
```

### Biome

`npx biome check src/views/admin/AdminBannersView.tsx src/views/admin/AdminShippingView.tsx tests/front/acess-onda2-contrato.test.tsx tests/front/admin-ajustes-salao-e-porao.test.tsx tests/front/admin-shipping-mototaxi.test.tsx tests/front/ajuda-e-inicio-letra-e-toque.test.ts tests/front/ajustes-grupos-e-portas.test.tsx tests/front/celular-estreito-rodape-contraste-toque.test.ts tests/front/estoque-baixo-um-limiar.test.ts tests/front/financeiro-cartoes-no-desenho-novo.test.tsx tests/front/helpers-compartilhados-do-grafico.test.ts tests/front/identity-build-finalization.test.ts tests/front/pedido-nota-e-rastreio-nao-se-perdem.test.tsx tests/front/produtos-cabem-no-celular.test.tsx tests/front/temas-do-painel-cobertura.test.ts tests/front/temas-do-painel-gerador.ts tests/front/vetos-de-atualizacao/banners.test.tsx scripts/frota/canais-de-backend.json scripts/frota/publicar-release.mjs scripts/publicacao/conferir-banco.cjs tests/frota_publicar_release_test.ts`

```text
Checked 21 files in 280ms. No fixes applied.
```

O primeiro check apontou seis arquivos para formatar e uma atribuição ao parâmetro do auxiliar de teste. Atribuição corrigida com variável local e apenas os seis arquivos apontados foram formatados; nenhum CSS gerado foi formatado manualmente.

### ESLint

`npx eslint src/views/admin/AdminBannersView.tsx src/views/admin/AdminShippingView.tsx tests/front/acess-onda2-contrato.test.tsx tests/front/admin-ajustes-salao-e-porao.test.tsx tests/front/admin-shipping-mototaxi.test.tsx tests/front/ajuda-e-inicio-letra-e-toque.test.ts tests/front/ajustes-grupos-e-portas.test.tsx tests/front/celular-estreito-rodape-contraste-toque.test.ts tests/front/estoque-baixo-um-limiar.test.ts tests/front/financeiro-cartoes-no-desenho-novo.test.tsx tests/front/helpers-compartilhados-do-grafico.test.ts tests/front/identity-build-finalization.test.ts tests/front/pedido-nota-e-rastreio-nao-se-perdem.test.tsx tests/front/produtos-cabem-no-celular.test.tsx tests/front/temas-do-painel-cobertura.test.ts tests/front/temas-do-painel-gerador.ts tests/front/vetos-de-atualizacao/banners.test.tsx scripts/frota/publicar-release.mjs scripts/publicacao/conferir-banco.cjs tests/frota_publicar_release_test.ts`

```text
21 problems (0 errors, 21 warnings)
0 errors and 9 warnings potentially fixable with the --fix option.
Código de saída: 0
```

Os avisos foram preservados no relatório, não ocultados nem tratados como aprovação sem ressalva. Saída completa local: `C:/Users/Gabriel/AppData/Local/Temp/claude/C--Users-Gabriel-Documents-ikcous-marketplace--claude-worktrees-sessao-anterior-78f354/6662513f-131b-4f21-bd1a-e4bf6d8f49f9/scratchpad/eslint-c-final.log`.

### Deno e cobertura de migrations

Com TEMP apontando para o scratchpad da sessão:

`deno test --allow-read --allow-env --allow-write=<scratchpad> tests/frota_publicar_release_test.ts`

```text
ok | 545 passed | 0 failed (409ms)
```

Inclui a guarda “toda migration >= 20261192000000 está em EXATAMENTE um lote do canais-de-backend.json ou em migrationsForaDaRelease”.

`deno test --allow-read --allow-env tests/migration_categorias_icones_test.ts tests/migration_estilo_card_frete_test.ts`

```text
ok | 9 passed | 0 failed (227ms)
```

Esses testes leem SQL e contratos; não aplicam SQL em banco. Primeiras chamadas sem as permissões locais de arquivo temporário/ambiente falharam por NotCapable; as chamadas acima são as finais aprovadas. Nenhuma permissão de rede de banco foi concedida.

### Build único e bytes

Ambiente: `IKCOUS_IDENTITY_MODE=fixture`, `NODE_ENV=production`.
Comandos: `npm run build`; depois `npx size-limit --json` ainda em fixture.

```text
4360 modules transformed.
built in 20.30s
Building src/sw/sw.ts service worker
4 modules transformed.
built in 206ms
precache 147 entries (4122.76 KiB)
files generated: dist-test/sw.js
Código de saída: 0
```

Avisos do build: comentários de anotação PURE do Zod ignorados pelo Rollup e um chunk acima do aviso de 500 kB minificado. Não houve alteração de tetos ou de chunking para esconder esses avisos.

Campos do JSON original do size-limit (nomes extensos dos chunks omitidos, números preservados):

```json
[
  { "grupo": "loja", "passed": true, "size": 548023, "sizeLimit": 552000 },
  { "grupo": "painel", "passed": true, "size": 469494, "sizeLimit": 472000 },
  { "grupo": "css", "passed": true, "size": 46295, "sizeLimit": 100000 },
  { "grupo": "leitor", "passed": true, "size": 334871, "sizeLimit": 400000 }
]
```

Saída completa local: `C:/Users/Gabriel/AppData/Local/Temp/claude/C--Users-Gabriel-Documents-ikcous-marketplace--claude-worktrees-sessao-anterior-78f354/6662513f-131b-4f21-bd1a-e4bf6d8f49f9/scratchpad/size-c-final.json`.
Não foi necessário medir delta por branch: os dois tetos foram atendidos.

## Seleção e histórico das provas

Busca nos testes pelos componentes/telas solicitados, checkout/cartão/Finalizar, temas, barras, leitor compartilhado e identidade/SW/porteiro; nomes de arquivos de barras e identidade também conferidos.
Nenhum lote teve mais de seis arquivos; todos usaram `--maxWorkers=1`.

A primeira rodada teve falhas nos lotes **1, 3, 25, 26, 39, 59, 63, 67, 69, 86 e 117**. As causas e correções estão acima. Todos esses lotes foram executados novamente, completos, após as correções; as saídas abaixo são as **últimas saídas de cada lote**. Não representam a execução de toda a suíte do repositório nem CI remoto.

## Pendências e fora do escopo

- Nenhuma falha pendente nas verificações locais explicitamente executadas.
- Não executados: CI remoto, testes vivos em PostgreSQL, teste físico de câmera/Android ou publicação externa.
- Nenhum push, PR, aplicação de migration, seed, deploy, envio de WhatsApp ou alteração de segredo.
- Nenhum novo serviço, framework ou sessão auxiliar iniciado.
- A versão do package.json continua 1.5.46: este despacho integrou o lote, não criou a release pública.
- Este relatório e as correções são commitados em `integracao-147-c`; o SHA final é informado no retorno do executor.

## Skills

- executar-tarefa: escopo do despacho, leitura antes da escrita e saídas observadas.
- git-workflow-and-versioning: merges separados e histórico preservado; prevaleceu a ordem específica do despacho.
- superpowers:systematic-debugging: distinguiu mocks/estrutura antigos de defeito real, sem alterar lógica por chute.
- superpowers:verification-before-completion: verificação final antes da entrega.

## Anexo — comando e resumo observado de cada lote

### Lote 1

`npx vitest run tests/front/about-store-view-endereco-e-descricao.test.tsx tests/front/about-store-view-mostra-o-que-a-loja-tem.test.tsx tests/front/acess-b6-skip-link-render.test.tsx tests/front/acess-onda1-0509-contrato.test.tsx tests/front/acess-onda1-contrato.test.tsx tests/front/acess-onda2-contrato.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  56 passed (56)
   Duration  6.50s (transform 1.04s, setup 116ms, import 1.30s, tests 1.63s, environment 2.46s)
```

### Lote 2

`npx vitest run tests/front/acess-onda3-invisivel-contrato.test.tsx tests/front/address-form-campos-nao-dao-zoom-no-iphone.test.tsx tests/front/address-form-cep-race.test.tsx tests/front/address-form-edicao-tardia-preenche.test.tsx tests/front/address-form-redesenho-cep-primeiro.test.tsx tests/front/address-form-rejeita-cep-incompleto.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  50 passed (50)
   Duration  8.21s (transform 722ms, setup 115ms, import 844ms, tests 2.17s, environment 4.09s)
```

### Lote 3

`npx vitest run tests/front/address-form-rua-manual-sobrevive-cep-sem-logradouro.test.tsx tests/front/address-form-troca-cep-nao-mistura-endereco-antigo.test.tsx tests/front/address-list-apagar-pede-confirmacao.test.tsx tests/front/admin-ajustes-salao-e-porao.test.tsx tests/front/admin-app-color.test.tsx tests/front/admin-banners-contraste-aa.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  80 passed (80)
   Duration  12.69s (transform 979ms, setup 125ms, import 831ms, tests 5.86s, environment 4.66s)
```

### Lote 4

`npx vitest run tests/front/admin-banners-default-nao-diverge.test.tsx tests/front/admin-banners-destino-nasce-vivo.test.tsx tests/front/admin-banners-duplicar-removido-nao-apaga-imagem-alheia.test.tsx tests/front/admin-banners-envio-preserva-rascunho.test.tsx tests/front/admin-banners-esc-fecha-so-o-cropper.test.tsx tests/front/admin-banners-ligar-desligar-falha-avisa.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  20 passed (20)
   Duration  15.35s (transform 701ms, setup 118ms, import 880ms, tests 8.41s, environment 4.94s)
```

### Lote 5

`npx vitest run tests/front/admin-banners-modelos-fluxo.test.tsx tests/front/admin-banners-preco-do-produto-com-virgula.test.tsx tests/front/admin-banners-recorte-nao-troca-editor.test.tsx tests/front/admin-banners-recorte-salva-o-tipo-real-da-imagem.test.tsx tests/front/admin-banners-salvar-durante-recorte.test.tsx tests/front/admin-banners-salvo-falho-nao-deixa-upload-orfao.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  42 passed (42)
   Duration  20.22s (transform 741ms, setup 106ms, import 359ms, tests 13.82s, environment 4.93s)
```

### Lote 6

`npx vitest run tests/front/admin-banners-upload-durante-salvar.test.tsx tests/front/admin-banners-upload-orfao-e-input.test.tsx tests/front/admin-banners-voltar-fecha-so-o-dialogo.test.tsx tests/front/admin-barra-tem-nome-acessivel.test.tsx tests/front/admin-barras-de-salvar-acopladas.test.tsx tests/front/admin-coupons-view-esgotado.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  48 passed (48)
   Duration  18.19s (transform 1.82s, setup 127ms, import 842ms, tests 11.26s, environment 4.97s)
```

### Lote 7

`npx vitest run tests/front/admin-coupons-view-expirado.test.tsx tests/front/admin-coupons-view-selos-do-alcance.test.tsx tests/front/admin-coupons-view-texto-do-checkout-nao-do-carrinho.test.tsx tests/front/admin-customers-ordenacao-ltv-e-ajuda-honesta.test.tsx tests/front/admin-customers-ticket-medio.test.tsx tests/front/admin-ficha-barra-de-acoes-nao-rola-junto.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  30 passed (30)
   Duration  15.73s (transform 712ms, setup 116ms, import 273ms, tests 10.16s, environment 4.19s)
```

### Lote 8

`npx vitest run tests/front/admin-ficha-cliente-abas.test.tsx tests/front/admin-ficha-cliente-resumo.test.tsx tests/front/admin-frete-avisa-transportadora-sem-pagamento.test.tsx tests/front/admin-frete-retirada-na-loja.test.tsx tests/front/admin-frete-v2-contrato.test.tsx tests/front/admin-limpar-campo-persiste-como-null.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  102 passed (102)
   Duration  19.66s (transform 1.22s, setup 104ms, import 4.66s, tests 8.94s, environment 4.94s)
```

### Lote 9

`npx vitest run tests/front/admin-mercado-pago-liberacao-automatica.test.tsx tests/front/admin-mercado-pago-pausar-avisa-transportadora.test.tsx tests/front/admin-notifications-view.test.tsx tests/front/admin-order-card-forma-de-pagamento.test.tsx tests/front/admin-orders-acoes-pendentes-subtitulo-honesto.test.tsx tests/front/admin-orders-alertas-compactos.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  73 passed (73)
   Duration  11.50s (transform 1.14s, setup 103ms, import 986ms, tests 4.51s, environment 4.92s)
```

### Lote 10

`npx vitest run tests/front/admin-orders-apresentacao-v6.test.tsx tests/front/admin-orders-cancelar-pela-edge.test.tsx tests/front/admin-orders-card-whatsapp-sem-destinatario.test.tsx tests/front/admin-orders-exporta-csv-do-periodo-inteiro.test.tsx tests/front/admin-orders-exporta-csv.test.ts tests/front/admin-orders-exportar-csv-rotulo-da-pagina.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  74 passed (74)
   Duration  14.73s (transform 1.24s, setup 116ms, import 1.67s, tests 7.82s, environment 4.14s)
```

### Lote 11

`npx vitest run tests/front/admin-orders-ficha-por-deep-link-nao-remonta.test.tsx tests/front/admin-orders-filtro-pagamento-estado-vazio-honesto.test.tsx tests/front/admin-orders-filtro-que-filtra.test.tsx tests/front/admin-orders-guia-do-pagamento-que-nao-fechou.test.tsx tests/front/admin-orders-payment-filter.test.tsx tests/front/admin-orders-status-erro-cru-nao-duplica-toast.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  39 passed (39)
   Duration  15.53s (transform 1.31s, setup 105ms, import 596ms, tests 8.91s, environment 4.92s)
```

### Lote 12

`npx vitest run tests/front/admin-orders-total-concluido-e-aviso-pago-cancelado.test.tsx tests/front/admin-orders-vazio-reconhece-primeira-venda.test.tsx tests/front/admin-orders-whatsapp-usa-o-nome-da-loja.test.tsx tests/front/admin-pdv-anular-venda-do-balcao.test.tsx tests/front/admin-pdv-conferi-o-pagamento.test.tsx tests/front/admin-pdv-cupom-e-cliente.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  33 passed (33)
   Duration  10.79s (transform 1.28s, setup 103ms, import 1.26s, tests 3.51s, environment 4.94s)
```

### Lote 13

`npx vitest run tests/front/admin-pdv-fechamento-e-recibo.test.tsx tests/front/admin-pdv-modos-de-produto.test.tsx tests/front/admin-pdv-rede-lenta-nao-trava-o-botao.test.tsx tests/front/admin-pdv-registro-no-roteador.test.tsx tests/front/admin-product-form-capa-sem-imagem.test.tsx tests/front/admin-product-form-categoria-renomeada-no-meio.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  49 passed (49)
   Duration  15.87s (transform 1.10s, setup 106ms, import 1.78s, tests 8.08s, environment 4.91s)
```

### Lote 14

`npx vitest run tests/front/admin-product-form-codigo-de-barras.test.tsx tests/front/admin-product-form-compressimage-fundo-preto.test.ts tests/front/admin-product-form-desligar-e-religar-variacao-na-linha.test.tsx tests/front/admin-product-form-desligar-ultima-variacao-zera-estoque.test.tsx tests/front/admin-product-form-draft-e-duplo-clique.test.tsx tests/front/admin-product-form-excluir-variacao-vendida-nao-perde-o-resto.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  48 passed (48)
   Duration  29.54s (transform 826ms, setup 104ms, import 338ms, tests 23.17s, environment 4.94s)
```

### Lote 15

`npx vitest run tests/front/admin-product-form-foto-principal-e-cadastro-que-falha.test.tsx tests/front/admin-product-form-foto-principal-e-reenvio.test.tsx tests/front/admin-product-form-foto-que-chega-depois-do-prazo.test.tsx tests/front/admin-product-form-fotos-e-grade-nao-travam-o-publicar.test.tsx tests/front/admin-product-form-grade-bordas.test.tsx tests/front/admin-product-form-grade-completar-e-chips.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  43 passed (43)
   Duration  45.56s (transform 835ms, setup 104ms, import 386ms, tests 39.13s, environment 4.94s)
```

### Lote 16

`npx vitest run tests/front/admin-product-form-grade-criar.test.tsx tests/front/admin-product-form-grade-preco-apagado-nao-zera-as-linhas.test.tsx tests/front/admin-product-form-grade-preco.test.tsx tests/front/admin-product-form-guia-diz-a-regra-real-do-estoque.test.tsx tests/front/admin-product-form-ler-com-a-camera.test.tsx tests/front/admin-product-form-preco-da-variacao-com-virgula.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  38 passed (38)
   Duration  63.16s (transform 823ms, setup 106ms, import 387ms, tests 56.77s, environment 4.90s)
```

### Lote 17

`npx vitest run tests/front/admin-product-form-preco-proprio-da-variacao-nao-vira-zero.test.tsx tests/front/admin-product-form-rascunho-nao-devolve-estoque.test.tsx tests/front/admin-product-form-rascunho-nao-guarda-variacao-ja-gravada.test.tsx tests/front/admin-product-form-salvar-nao-devolve-estoque-velho.test.tsx tests/front/admin-product-form-teto-de-variacoes-no-novo.test.tsx tests/front/admin-product-form-tornar-foto-principal.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  42 passed (42)
   Duration  40.67s (transform 806ms, setup 107ms, import 352ms, tests 34.29s, environment 4.92s)
```

### Lote 18

`npx vitest run tests/front/admin-product-form-um-grupo-de-variacao.test.tsx tests/front/admin-product-form-upload-usa-o-tipo-real-da-imagem.test.tsx tests/front/admin-product-form-variacao-preco-zero-fica-visivel.test.tsx tests/front/admin-product-form-variacao-sku-e-publicar-diz-o-que-falta.test.tsx tests/front/admin-product-form-variante-aponta-imagem.test.tsx tests/front/admin-product-form-variante-composta.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  35 passed (35)
   Duration  28.91s (transform 816ms, setup 104ms, import 312ms, tests 22.60s, environment 4.92s)
```

### Lote 19

`npx vitest run tests/front/admin-products-esgotado.test.tsx tests/front/admin-products-kpi-apos-mexer-no-catalogo.test.tsx tests/front/admin-products-lista-honesta-com-busca-e-filtro.test.tsx tests/front/admin-products-lucro-so-com-custo.test.tsx tests/front/admin-products-margem-sem-custo.test.tsx tests/front/admin-products-potencial-duas-casas-decimais.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  49 passed (49)
   Duration  14.31s (transform 2.14s, setup 113ms, import 2.29s, tests 5.96s, environment 4.95s)
```

### Lote 20

`npx vitest run tests/front/admin-push-cabecalho-nao-estoura-no-mobile.test.tsx tests/front/admin-push-destinatario-corrida.test.tsx tests/front/admin-push-modelo-sem-cupom-falso.test.tsx tests/front/admin-push-nao-promete-avisos-de-compras.test.tsx tests/front/admin-push-radio-do-lojista.test.tsx tests/front/admin-push-view-contadores.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  44 passed (44)
   Duration  21.98s (transform 346ms, setup 105ms, import 345ms, tests 15.62s, environment 4.91s)
```

### Lote 21

`npx vitest run tests/front/admin-qa-view-erro-nao-e-fila-limpa.test.tsx tests/front/admin-reviews-fila-vem-do-banco.test.tsx tests/front/admin-settings-cor-da-loja.test.tsx tests/front/admin-settings-identidade-da-loja.test.tsx tests/front/admin-settings-pix-acompanha-o-interruptor.test.tsx tests/front/admin-settings-secoes-colapsaveis.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  26 passed (26)
   Duration  13.73s (transform 1.12s, setup 106ms, import 309ms, tests 7.30s, environment 4.99s)
```

### Lote 22

`npx vitest run tests/front/admin-shipping-ate-onde-entrega-liga-as-transportadoras.test.tsx tests/front/admin-shipping-erro-teste-credenciais-traduzido.test.tsx tests/front/admin-shipping-frete-por-provedor.test.tsx tests/front/admin-shipping-frete-unificado.test.tsx tests/front/admin-shipping-mototaxi.test.tsx tests/front/admin-shipping-nao-inventa-cep-de-origem.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  43 passed (43)
   Duration  10.89s (transform 489ms, setup 104ms, import 614ms, tests 4.28s, environment 4.90s)
```

### Lote 23

`npx vitest run tests/front/admin-shipping-national-view.test.tsx tests/front/admin-shipping-tela-nao-promete-cobranca.test.tsx tests/front/admin-shipping-trocar-de-aba-nao-apaga-o-que-foi-digitado.test.tsx tests/front/admin-shipping-view-estrategia-nacional-na-faixa.test.tsx tests/front/admin-sobre-a-loja-salva-sem-apagar.test.tsx tests/front/admin-store-identity.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  149 passed (149)
   Duration  13.02s (transform 766ms, setup 108ms, import 463ms, tests 6.47s, environment 4.95s)
```

### Lote 24

`npx vitest run tests/front/admin-user-detail-corrida-de-usuario.test.tsx tests/front/admin-user-detail-pedidos-que-contam.test.tsx tests/front/admin-user-detail-status-pending-traduzido.test.tsx tests/front/admin-visual-canais-avisar.test.tsx tests/front/admin-visual-frete.test.tsx tests/front/admin-visual-telas-titulo-padronizado.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  73 passed (73)
   Duration  19.05s (transform 1.48s, setup 117ms, import 1.07s, tests 12.75s, environment 4.11s)
```

### Lote 25

`npx vitest run tests/front/admin-vitrines-redesenho.test.tsx tests/front/ajuda-do-crm-lucro-sem-custo.test.tsx tests/front/ajuda-do-dashboard-descreve-os-kpis-da-tela.test.tsx tests/front/ajuda-do-painel-e-dialogo.test.tsx tests/front/ajuda-e-inicio-letra-e-toque.test.ts tests/front/ajustes-disclosure-do-diagnostico.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  83 passed (83)
   Duration  13.80s (transform 1.33s, setup 139ms, import 1.36s, tests 6.19s, environment 4.95s)
```

### Lote 26

`npx vitest run tests/front/ajustes-grupos-e-portas.test.tsx tests/front/ajustes-horario-de-atendimento.test.tsx tests/front/ajustes-identidade-e-horario-so-em-sobre-a-loja.test.tsx tests/front/ajustes-v5-recebimentos.test.tsx tests/front/app-aba-ativa-com-formulario-sujo-nao-desliga-a-guarda.test.tsx tests/front/app-instalado-nao-trava-a-orientacao.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  52 passed (52)
   Duration  12.11s (transform 1.25s, setup 121ms, import 1.45s, tests 5.23s, environment 4.29s)
```

### Lote 27

`npx vitest run tests/front/app-popstate-camada-antes-do-dirty.test.tsx tests/front/atalhos-do-inicio-so-dois-botoes-grandes.test.tsx tests/front/atendimento-abre-minha-loja.test.tsx tests/front/atendimento-nao-grava-horario.test.tsx tests/front/atualizacao/apply-respeita-o-veto.test.ts tests/front/atualizacao/autorizar-purga.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  49 passed (49)
   Duration  18.77s (transform 1.03s, setup 118ms, import 896ms, tests 12.64s, environment 4.12s)
```

### Lote 28

`npx vitest run tests/front/atualizacao/gate-orquestra-a-atualizacao.test.tsx tests/front/atualizacao/instalador.test.tsx tests/front/atualizacao/momento-seguro.test.ts tests/front/atualizacao/use-update-check-contrato.test.ts tests/front/atualizacao/veto-de-recarga.test.ts tests/front/auth-admin-check.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  197 passed (197)
   Duration  5.41s (transform 351ms, setup 115ms, import 367ms, tests 649ms, environment 3.29s)
```

### Lote 29

`npx vitest run tests/front/auth-rastreio-de-convidado-e-rascunhos-por-usuario.test.tsx tests/front/auth-sair-zera-o-adiamento-dos-avisos.test.tsx tests/front/auth-view-cadastro-confirmacao-condicional-e-senha-minima.test.tsx tests/front/auth-view-reset-prompt-copy.test.tsx tests/front/avaliacoes-e-avisos-letra-l.test.tsx tests/front/avaliacoes-sem-dado-nao-inventa-porcentagem.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  30 passed (30)
   Duration  8.35s (transform 475ms, setup 114ms, import 264ms, tests 2.86s, environment 4.10s)
```

### Lote 30

`npx vitest run tests/front/aviso-atualizacao-mostra-versao-limpa.test.tsx tests/front/aviso-de-regiao-olha-a-cobertura.test.tsx tests/front/aviso-transportadora-sem-pagamento-regra.test.ts tests/front/avisos-do-aparelho-situacao.test.ts tests/front/balcao-busca-do-produto-corrida.test.tsx tests/front/balcao-busca-do-produto-mostra-tudo.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  63 passed (63)
   Duration  9.33s (transform 1.67s, setup 115ms, import 1.52s, tests 2.56s, environment 4.12s)
```

### Lote 31

`npx vitest run tests/front/balcao-cancelar-venda-limpa-o-cupom.test.tsx tests/front/balcao-desfazer-recebimento-pede-confirmacao.test.tsx tests/front/balcao-explica-anular-e-cancelar.test.tsx tests/front/balcao-leitor-fisico-em-buscar.test.tsx tests/front/balcao-leitura-atrasada-nao-entra-na-venda-nova.test.tsx tests/front/balcao-redesenho-aprovado.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  48 passed (48)
   Duration  10.77s (transform 1.01s, setup 103ms, import 1.87s, tests 2.88s, environment 4.93s)
```

### Lote 32

`npx vitest run tests/front/banner-datas-sem-sentido.test.tsx tests/front/banner-destino-do-link.test.tsx tests/front/banner-link-digitado-sem-https.test.tsx tests/front/banner-link-so-http-e-caminho.test.tsx tests/front/banner-upload-atrasado-apaga-o-arquivo-orfao.test.tsx tests/front/banner-upload-atrasado-nao-troca-a-imagem-de-outro.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  302 passed (302)
   Duration  27.63s (transform 770ms, setup 104ms, import 404ms, tests 21.19s, environment 4.94s)
```

### Lote 33

`npx vitest run tests/front/banners-letra-l.test.tsx tests/front/banners-modo-lembrado.test.tsx tests/front/build-identity-runtime.test.tsx tests/front/c6-chave-pedido-tentativa.test.tsx tests/front/c6-desafio-com-pix.test.tsx tests/front/c6-desafio-pix-respostas.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  68 passed (68)
   Duration  19.11s (transform 1.64s, setup 114ms, import 326ms, tests 13.57s, environment 4.12s)
```

### Lote 34

`npx vitest run tests/front/c6-recusa-pos-3ds.test.tsx tests/front/canais-do-crm-cores-das-formas.test.tsx tests/front/cancelar-enviado-otimista-marca-que-precisa-devolver.test.tsx tests/front/cancelar-pedido-online-pela-edge.test.tsx tests/front/cancelar-pedido-pago-avisa-do-dinheiro.test.tsx tests/front/cancelar-pedido-recusa-cartao-vivo.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  66 passed (66)
   Duration  15.77s (transform 2.10s, setup 115ms, import 545ms, tests 9.98s, environment 4.14s)
```

### Lote 35

`npx vitest run tests/front/card-nao-deixa-comprar-sem-escolher-a-variacao.test.tsx tests/front/carrinho-dos-cards-app-real-integracao.test.tsx tests/front/carrinho-fala-so-frete-gratis.test.tsx tests/front/carrinho-frete-local-e-nacional-independentes.test.tsx tests/front/carrinho-mostra-a-variacao-escolhida.test.tsx tests/front/carrinho-nao-esconde-calculadora-quando-o-servidor-pode-discordar.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  32 passed (32)
   Duration  13.98s (transform 1.31s, setup 103ms, import 1.07s, tests 6.93s, environment 4.88s)
```

### Lote 36

`npx vitest run tests/front/carrinho-retirada-nao-comemora-liberado-sem-gratis.test.tsx tests/front/carrinho-variantes-e-exclusao-remota.test.tsx tests/front/cart-context-estoque-zero-tira-o-item.test.tsx tests/front/cart-context-renova-sob-demanda.test.tsx tests/front/cart-context-variant-names.test.tsx tests/front/cart-view-frete-automatico.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  29 passed (29)
   Duration  9.43s (transform 512ms, setup 107ms, import 778ms, tests 2.67s, environment 4.90s)
```

### Lote 37

`npx vitest run tests/front/cart-view-promessa-do-convidado.test.tsx tests/front/cart-view-promessas-que-a-loja-nao-cumpre.test.tsx tests/front/cart-view-seletor-de-endereco.test.tsx tests/front/cartao-aprovado-no-post-espera-o-webhook.test.tsx tests/front/cartao-confirmacao-sem-fim.test.tsx tests/front/cartao-de-avisos-do-aparelho.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  75 passed (75)
   Duration  11.94s (transform 1.14s, setup 104ms, import 616ms, tests 5.30s, environment 4.92s)
```

### Lote 38

`npx vitest run tests/front/cartao-em-duvida-sem-analise.test.tsx tests/front/cartao-email-de-teste-so-na-previa.test.tsx tests/front/cartao-redesenho-mensagens.test.ts tests/front/cartao-redesenho-tela.test.tsx tests/front/catalogo-do-carrinho.test.ts tests/front/categorias-foco-volta-ao-campo-apos-falha.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  124 passed (124)
   Duration  8.92s (transform 590ms, setup 118ms, import 1.46s, tests 2.25s, environment 4.10s)
```

### Lote 39

`npx vitest run tests/front/categorias-icones.test.tsx tests/front/categorias-nome-trava-durante-renomear.test.tsx tests/front/celular-estreito-rodape-contraste-toque.test.ts tests/front/chave-do-pedido-inclui-meio-de-pagamento.test.ts tests/front/checkout-campos-nao-dao-zoom-no-iphone.test.tsx tests/front/checkout-chave-de-idempotencia-muda-com-o-eixo-do-pagamento.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  57 passed (57)
   Duration  8.29s (transform 1.13s, setup 130ms, import 562ms, tests 3.11s, environment 3.45s)
```

### Lote 40

`npx vitest run tests/front/checkout-chave-mp-vem-da-ficha.test.tsx tests/front/checkout-compacto-e-cpf.test.tsx tests/front/checkout-compra-zerada-fecha-na-retirada.test.tsx tests/front/checkout-conferir-antes-tranca-o-finalizar.test.tsx tests/front/checkout-config-do-cartao-carregando-e-erro.test.tsx tests/front/checkout-convidada-tenta-de-novo-a-mesma-compra.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  71 passed (71)
   Duration  32.06s (transform 1.17s, setup 103ms, import 459ms, tests 25.61s, environment 4.91s)
```

### Lote 41

`npx vitest run tests/front/checkout-convidado-cep-parcial-nao-e-fora-da-cidade.test.tsx tests/front/checkout-convidado-loja-so-pelo-app.test.tsx tests/front/checkout-convidado-sai-do-beco-na-tela-de-sucesso.test.tsx tests/front/checkout-convidado-so-compra-local.test.tsx tests/front/checkout-convidado-so-retiro-nao-trava.test.tsx tests/front/checkout-cupons-desligados-descartam-o-cupom.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  28 passed (28)
   Duration  38.72s (transform 968ms, setup 107ms, import 345ms, tests 32.35s, environment 4.92s)
```

### Lote 42

`npx vitest run tests/front/checkout-cupons-disponiveis.test.tsx tests/front/checkout-economia-do-frete-na-barra.test.tsx tests/front/checkout-frete-automatico-troca-de-endereco.test.tsx tests/front/checkout-frete-de-outro-cep-nao-pinta.test.tsx tests/front/checkout-guest-cep-falha-limpa-endereco-do-cep-anterior.test.tsx tests/front/checkout-guest-cep-nao-sobrescreve-o-que-o-cliente-digitou.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  74 passed (74)
   Duration  27.09s (transform 1.11s, setup 107ms, import 483ms, tests 20.15s, environment 5.29s)
```

### Lote 43

`npx vitest run tests/front/checkout-guest-cep-pre-preenchido-troca-nao-mistura.test.tsx tests/front/checkout-guest-cep-teclado-numerico.test.tsx tests/front/checkout-guest-cep.test.tsx tests/front/checkout-guest-endereco-editavel-cobertura-local.test.tsx tests/front/checkout-guest-rua-manual-sobrevive-cep-sem-logradouro.test.tsx tests/front/checkout-guest-troca-cep-nao-mistura-endereco-antigo.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  11 passed (11)
   Duration  12.95s (transform 893ms, setup 109ms, import 343ms, tests 6.33s, environment 5.15s)
```

### Lote 44

`npx vitest run tests/front/checkout-nao-apaga-o-digitado-e-whatsapp-completo.test.tsx tests/front/checkout-nao-fecha-sem-frete-selecionado.test.tsx tests/front/checkout-nao-preenche-endereco-do-cliente.test.tsx tests/front/checkout-oferece-saida-na-recusa.test.tsx tests/front/checkout-ordem-dos-campos-de-endereco.test.tsx tests/front/checkout-pedido-pendente-limpa-no-logout.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  48 passed (48)
   Duration  14.85s (transform 1.98s, setup 119ms, import 2.02s, tests 7.42s, environment 4.26s)
```

### Lote 45

`npx vitest run tests/front/checkout-perfil-de-outra-conta-nao-vaza.test.tsx tests/front/checkout-recarga-no-app.test.tsx tests/front/checkout-recarga-sessao-lenta.test.tsx tests/front/checkout-recusa-atualiza-o-carrinho-de-verdade.test.tsx tests/front/checkout-recusa-de-entrega-manda-para-a-conta.test.tsx tests/front/checkout-resposta-e-pagamento-regressoes.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  55 passed (55)
   Duration  35.15s (transform 1.37s, setup 110ms, import 648ms, tests 28.35s, environment 5.03s)
```

### Lote 46

`npx vitest run tests/front/checkout-retirada-na-loja.test.tsx tests/front/checkout-retomada-cancelar-nao-promete-carrinho-vazio.test.tsx tests/front/checkout-retomada-forma-do-pedido.test.tsx tests/front/checkout-retomada-leitura-do-pedido-falha-avisa.test.tsx tests/front/checkout-retomada-leitura-em-voo-nao-cria-pedido-novo.test.tsx tests/front/checkout-retomada-metodo-atrasado.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  47 passed (47)
   Duration  14.05s (transform 1.03s, setup 123ms, import 393ms, tests 7.59s, environment 4.94s)
```

### Lote 47

`npx vitest run tests/front/checkout-retomada-pagamento.test.tsx tests/front/checkout-retomada-recarga.test.tsx tests/front/checkout-retomada-verificacao.test.tsx tests/front/checkout-sem-rede-nao-trava-o-botao.test.tsx tests/front/checkout-seta-voltar-so-fecha-painel-primeiro-toque.test.tsx tests/front/checkout-summary-bar.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  57 passed (57)
   Duration  28.47s (transform 1.29s, setup 104ms, import 754ms, tests 21.65s, environment 4.97s)
```

### Lote 48

`npx vitest run tests/front/checkout-transportadora-aviso-com-config-do-cartao.test.tsx tests/front/checkout-transportadora-exige-antecipado.test.tsx tests/front/checkout-trava-sincrona-do-finalizar.test.ts tests/front/checkout-troca-de-conta-nao-herda-nome-e-whatsapp.test.tsx tests/front/checkout-view-cancelar-pagamento-falho.test.tsx tests/front/checkout-view-cancelar-pela-edge.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  46 passed (46)
   Duration  21.98s (transform 1.07s, setup 115ms, import 362ms, tests 16.41s, environment 4.11s)
```

### Lote 49

`npx vitest run tests/front/checkout-view-cartao-em-duvida.test.tsx tests/front/checkout-view-cartao-erro-oferece-pix-e-em-analise.test.tsx tests/front/checkout-view-cartao-forma-desligada.test.tsx tests/front/checkout-view-cartao-online.test.tsx tests/front/checkout-view-erro-de-pedido-traduzido.test.tsx tests/front/checkout-view-flag-off.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  71 passed (71)
   Duration  53.23s (transform 1.10s, setup 104ms, import 435ms, tests 46.78s, environment 4.90s)
```

### Lote 50

`npx vitest run tests/front/checkout-view-flag-on.test.tsx tests/front/checkout-view-frete-desatualizado-recusa-pedido.test.tsx tests/front/checkout-view-frete-marcado-confere-com-a-cotacao.test.tsx tests/front/checkout-view-pix-confirmacao.test.tsx tests/front/checkout-view-pix-pedido-morto-no-servidor.test.tsx tests/front/checkout-view-revisao-do-frete-antes-de-fechar.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  44 passed (44)
   Duration  20.89s (transform 1.03s, setup 106ms, import 396ms, tests 14.46s, environment 4.92s)
```

### Lote 51

`npx vitest run tests/front/checkout-view-selos-contraste-aa.test.tsx tests/front/cliente-cancela-conforme-o-envio.test.tsx tests/front/cliente-cancela-pedido-pago-le-a-verdade.test.tsx tests/front/clientes-cabem-no-celular.test.tsx tests/front/config-do-cartao.test.ts tests/front/configuracao-da-loja-pela-ficha.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  82 passed (82)
   Duration  17.50s (transform 1.63s, setup 119ms, import 390ms, tests 11.90s, environment 4.09s)
```

### Lote 52

`npx vitest run tests/front/configuracao-da-loja-sem-ficha-em-producao-falha-fechada.test.ts tests/front/confirmacao-do-cartao.test.ts tests/front/cores-onda1-regressoes.test.tsx tests/front/cores-onda2a-regressoes.test.tsx tests/front/cores-status-admin.test.tsx tests/front/cotacao-vale-so-para-o-destino.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  71 passed (71)
   Duration  6.72s (transform 945ms, setup 126ms, import 2.10s, tests 522ms, environment 2.85s)
```

### Lote 53

`npx vitest run tests/front/coupon-input-aplicando.test.tsx tests/front/cpf-da-conta.test.ts tests/front/create-order-rpc.test.ts tests/front/criar-pagamento-erro-cartao-em-analise.test.ts tests/front/criar-pagamento-erro-verificacao-indisponivel.test.ts tests/front/crm-clientes-grupos-novos-revisao.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  80 passed (80)
   Duration  4.41s (transform 459ms, setup 132ms, import 766ms, tests 600ms, environment 1.85s)
```

### Lote 54

`npx vitest run tests/front/crm-contraste-aa.test.tsx tests/front/crm-visao-geral-sem-rolagem-lateral.test.tsx tests/front/cupom-do-banco.test.ts tests/front/cupom-do-checkout-pendurado-vira-erro.test.tsx tests/front/cupom-preso.test.ts tests/front/cupons-do-checkout-lib.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  66 passed (66)
   Duration  8.71s (transform 2.20s, setup 125ms, import 2.38s, tests 1.58s, environment 3.58s)
```

### Lote 55

`npx vitest run tests/front/cupons-do-checkout-secao.test.tsx tests/front/cupons-letra-l.test.tsx tests/front/customer-footer-reserva-medida.test.tsx tests/front/dashboard-cep-oito-digitos.test.tsx tests/front/dashboard-diz-o-que-falta-para-vender.test.tsx tests/front/debounced-search-input.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  87 passed (87)
   Duration  11.11s (transform 2.09s, setup 115ms, import 3.92s, tests 903ms, environment 5.15s)
```

### Lote 56

`npx vitest run tests/front/dependencias-enxutas-contrato.test.ts tests/front/dependencias-enxutas-da-loja.test.ts tests/front/deployment-explica-as-duas-origens-de-credencial.test.ts tests/front/desktop-produto-duas-colunas.test.tsx tests/front/destino-pos-login-painel.test.ts tests/front/destino-pos-login-user-profile.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  87 passed (87)
   Duration  11.12s (transform 775ms, setup 121ms, import 3.94s, tests 5.20s, environment 840ms)
```

### Lote 57

`npx vitest run tests/front/destino-pos-login.test.ts tests/front/device-id-mercado-pago.test.ts tests/front/devolucao-cliente-nao-mostra-a-do-outro-pedido.test.tsx tests/front/devolucao-entregue-sem-recebimento-marcado.test.tsx tests/front/devolucao-falha-de-leitura-aparece-e-tenta-de-novo.test.tsx tests/front/devolucao-liberar-vinculo-reverso.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  70 passed (70)
   Duration  9.38s (transform 617ms, setup 120ms, import 331ms, tests 3.69s, environment 4.23s)
```

### Lote 58

`npx vitest run tests/front/devolucao-no-pedido-do-cliente.test.tsx tests/front/devolucao-painel-etiqueta-reversa-avisos.test.tsx tests/front/economia-do-frete-cotacao-hook.test.tsx tests/front/elegibilidade-da-etiqueta.test.ts tests/front/endereco-e-horario-tem-um-dono.test.ts tests/front/entrega-frete-simplificada.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  266 passed (266)
   Duration  29.89s (transform 924ms, setup 116ms, import 424ms, tests 25.02s, environment 3.34s)
```

### Lote 59

`npx vitest run tests/front/erro-de-pedido-nao-mostra-texto-cru-do-banco.test.ts tests/front/estabilidade-c2-rastreio.test.tsx tests/front/estoque-baixo-concorda-singular-card.test.tsx tests/front/estoque-baixo-um-limiar.test.ts tests/front/estorno-card-lojista-devolve-o-dinheiro.test.tsx tests/front/estorno-card-remonta-por-pedido.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  76 passed (76)
   Duration  9.69s (transform 1.37s, setup 122ms, import 1.42s, tests 2.86s, environment 4.27s)
```

### Lote 60

`npx vitest run tests/front/etiqueta-do-pedido-card.test.tsx tests/front/ficha-alvos-e-letra-l.test.tsx tests/front/ficha-cancelar-pago-diz-quem-devolve.test.tsx tests/front/ficha-da-loja-falha-visivel.test.ts tests/front/ficha-da-loja-leitura.test.ts tests/front/ficha-da-loja-vence-o-assado.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  87 passed (87)
   Duration  12.38s (transform 956ms, setup 107ms, import 409ms, tests 5.83s, environment 5.01s)
```

### Lote 61

`npx vitest run tests/front/ficha-do-cliente-carrinho-no-celular.test.tsx tests/front/ficha-do-pedido-anular-venda-do-balcao.test.tsx tests/front/ficha-do-pedido-copiar-endereco-falha-avisa.test.tsx tests/front/ficha-do-pedido-estorno-pela-ficha.test.tsx tests/front/ficha-do-pedido-mesa-do-lojista.test.tsx tests/front/ficha-do-pedido-mostra-variacao.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  49 passed (49)
   Duration  14.17s (transform 1.38s, setup 105ms, import 399ms, tests 7.74s, environment 4.93s)
```

### Lote 62

`npx vitest run tests/front/ficha-do-pedido-ordem-devolucao-estorno.test.tsx tests/front/ficha-do-pedido-pergunta-se-recebeu-ao-entregar.test.tsx tests/front/ficha-do-pedido-redesenho.test.tsx tests/front/ficha-do-pedido-reenvia-comprovante.test.tsx tests/front/ficha-do-pedido-resposta-antiga-nao-apaga-tamanho.test.tsx tests/front/ficha-do-pedido-sem-valor-a-pagar.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  74 passed (74)
   Duration  13.01s (transform 1.34s, setup 108ms, import 1.07s, tests 5.92s, environment 4.90s)
```

### Lote 63

`npx vitest run tests/front/ficha-do-pedido-whatsapp-sem-destinatario-nao-renderiza.test.tsx tests/front/ficha-e-consultas-acabamento.test.tsx tests/front/finalizar-bloqueado-por-frete.test.ts tests/front/financeiro-cartoes-no-desenho-novo.test.tsx tests/front/financeiro-fluxo-um-balao-so.test.tsx tests/front/financeiro-lib.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  83 passed (83)
   Duration  12.58s (transform 1.72s, setup 119ms, import 1.54s, tests 6.48s, environment 3.43s)
```

### Lote 64

`npx vitest run tests/front/forma-de-entrega-da-nota.test.ts tests/front/forma-de-pagamento.test.ts tests/front/formas-de-pagamento-cartao-pelo-app.test.tsx tests/front/formulario-produto-letra-e-toque-l.test.tsx tests/front/free-shipping-block-carrinho-vazio-cabe-na-tela.test.tsx tests/front/free-shipping-block-estilo.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  59 passed (59)
   Duration  4.93s (transform 239ms, setup 116ms, import 467ms, tests 915ms, environment 2.46s)
```

### Lote 65

`npx vitest run tests/front/frete-local-ate-onde-entrega.test.tsx tests/front/frete-minimo-em-centavos-lembrete-e-bloco.test.tsx tests/front/frete-nao-grava-cep.test.tsx tests/front/frete-resposta-do-salvar-nao-apaga-edicao.test.tsx tests/front/frete-um-lugar-so.test.tsx tests/front/frete-v2-presets-contrato.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  83 passed (83)
   Duration  12.05s (transform 946ms, setup 108ms, import 578ms, tests 5.47s, environment 4.90s)
```

### Lote 66

`npx vitest run tests/front/gerenciar-categorias-tela.test.tsx tests/front/global-error-boundary-chunk-sem-trava.test.tsx tests/front/grafico-enxuto-contrato.test.ts tests/front/guarda-de-cor-sai-junto-com-a-escrita.test.ts tests/front/header-center-slot.test.tsx tests/front/header-logo-atualizada.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  65 passed (65)
   Duration  13.37s (transform 4.04s, setup 118ms, import 5.01s, tests 3.96s, environment 3.29s)
```

### Lote 67

`npx vitest run tests/front/helpers-compartilhados-do-grafico.test.ts tests/front/home-categoria-desconhecida-vira-todas.test.tsx tests/front/home-horario-de-funcionamento-chega.test.tsx tests/front/home-nao-pula-contrato.test.tsx tests/front/home-rede-falhando-nao-parece-loja-vazia.test.tsx tests/front/horario-resposta-da-sessao.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  81 passed (81)
   Duration  11.32s (transform 2.87s, setup 126ms, import 3.49s, tests 2.61s, environment 4.10s)
```

### Lote 68

`npx vitest run tests/front/icones-do-app-no-avancado.test.tsx tests/front/identidade-bootstrap-lancador.test.ts tests/front/identidade-bootstrap.test.ts tests/front/identidade-da-loja-nas-telas.test.tsx tests/front/identity-build-config-delivery.test.ts tests/front/identity-build-config-public-env.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  82 passed (82)
   Duration  10.36s (transform 924ms, setup 122ms, import 1.78s, tests 5.64s, environment 1.77s)
```

### Lote 69

`npx vitest run tests/front/identity-build-config.test.ts tests/front/identity-build-finalization.test.ts tests/front/identity-build-integration.test.ts tests/front/identity-settings-section.test.tsx tests/front/identity-upload-http.test.ts tests/front/identity-upload-resume.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  293 passed (293)
   Duration  16.74s (transform 603ms, setup 118ms, import 2.62s, tests 12.18s, environment 836ms)
```

### Lote 70

`npx vitest run tests/front/inicio-data-e-hoje-acompanham-o-relogio.test.tsx tests/front/inicio-do-painel.test.tsx tests/front/inicio-estoque-baixo-mesmo-limiar.test.ts tests/front/inicio-mostra-o-cartao-de-avisos-so-com-a-aba-a-vista.test.tsx tests/front/kpi-executivo-resposta-atrasada-nao-grava.test.tsx tests/front/kpis-globais-de-avaliacoes-nao-seguem-o-filtro.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  34 passed (34)
   Duration  18.01s (transform 2.62s, setup 123ms, import 3.62s, tests 8.90s, environment 4.32s)
```

### Lote 71

`npx vitest run tests/front/lacuna-l1-soltura-expiracao.test.tsx tests/front/lacuna-l2-reload-3ds-id-real.test.tsx tests/front/leitor-de-codigo-componente.test.tsx tests/front/leitor-de-codigo-hook.test.tsx tests/front/limpar-tudo-limpa-de-verdade.test.tsx tests/front/listas-falam-a-lingua-da-loja.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  71 passed (71)
   Duration  25.10s (transform 1.90s, setup 113ms, import 567ms, tests 17.69s, environment 5.63s)
```

### Lote 72

`npx vitest run tests/front/local-identity-build-fixture.test.ts tests/front/logos-do-frete-versionados.test.ts tests/front/loja-pronta-entrega-alcance-curto.test.tsx tests/front/loja-tem-whatsapp-regra-unica.test.ts tests/front/manutencao-vem-da-ficha.test.tsx tests/front/marca-do-frete.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  128 passed (128)
   Duration  7.01s (transform 720ms, setup 117ms, import 853ms, tests 3.01s, environment 1.69s)
```

### Lote 73

`npx vitest run tests/front/mercado-pago-chave-de-teste-avisa.test.tsx tests/front/mercado-pago-guia-copia-prompt.test.tsx tests/front/metricas-cabem-no-celular.test.tsx tests/front/minha-loja-contato.test.tsx tests/front/minha-loja-dados-da-empresa.test.tsx tests/front/minha-loja-fala-a-lingua-da-loja.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  88 passed (88)
   Duration  17.14s (transform 656ms, setup 115ms, import 849ms, tests 9.89s, environment 5.24s)
```

### Lote 74

`npx vitest run tests/front/minha-loja-marca-nao-reverte-cidade.test.tsx tests/front/minha-loja-salvar-unico.test.tsx tests/front/minha-loja-troca-de-cep-acompanha-o-alcance.test.tsx tests/front/moderacao-ativa-e-real.test.tsx tests/front/motivo-do-bloqueio-do-produto.test.ts tests/front/mototaxi.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  88 passed (88)
   Duration  16.31s (transform 1.26s, setup 128ms, import 1.00s, tests 9.89s, environment 4.27s)
```

### Lote 75

`npx vitest run tests/front/nenhuma-escrita-direta-em-notes-do-pedido.test.ts tests/front/nome-curto-da-loja.test.ts tests/front/nome-da-loja-vem-do-banco.test.tsx tests/front/notifications-view-botao-excluir-visivel-no-celular.test.tsx tests/front/novidades-na-central/admin-notifications-novidades.test.tsx tests/front/numero-do-pedido-igual-em-todas-as-telas-de-pagamento.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  42 passed (42)
   Duration  7.86s (transform 533ms, setup 118ms, import 990ms, tests 2.24s, environment 3.47s)
```

### Lote 76

`npx vitest run tests/front/numero-do-pedido-igual-nas-telas-de-confirmacao.test.tsx tests/front/ofertas-compactas.test.tsx tests/front/ofertas-mostram-preco-e-disponivel-primeiro.test.tsx tests/front/ordenacao-da-vitrine-sem-mais-vendidos.test.tsx tests/front/order-detail-aviso-pagamento-pendente.test.tsx tests/front/order-detail-ignora-tracking-de-pedido-antigo.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  49 passed (49)
   Duration  11.39s (transform 1.68s, setup 104ms, import 1.38s, tests 3.85s, environment 5.05s)
```

### Lote 77

`npx vitest run tests/front/order-detail-item-sem-produto-nao-mostra-id-vazio.test.tsx tests/front/order-detail-nao-inventa-cidade.test.tsx tests/front/order-details-acompanha-o-ao-vivo.test.tsx tests/front/order-details-atualiza-sozinha-quando-o-pedido-muda.test.tsx tests/front/order-details-cancelar-pela-edge.test.tsx tests/front/order-details-cartao-de-avaliacao-em-destaque.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  55 passed (55)
   Duration  12.43s (transform 1.11s, setup 110ms, import 320ms, tests 6.05s, environment 4.94s)
```

### Lote 78

`npx vitest run tests/front/order-details-codigo-de-rastreio.test.tsx tests/front/order-details-devolucao-nao-afirma-antes-de-saber.test.tsx tests/front/order-details-fechar-avaliacao-nao-perde-o-texto.test.tsx tests/front/order-details-foto-do-item-nunca-fica-quebrada.test.tsx tests/front/order-details-gate-avaliacoes.test.tsx tests/front/order-details-hero-entregue-contraste-aa.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  29 passed (29)
   Duration  12.18s (transform 512ms, setup 107ms, import 288ms, tests 5.72s, environment 5.05s)
```

### Lote 79

`npx vitest run tests/front/order-details-pagamento-e-endereco-completos.test.tsx tests/front/order-details-pagamento-vencido-diz-o-motivo.test.tsx tests/front/order-details-pagar-na-entrega-nao-diz-que-falta-pagar.test.tsx tests/front/order-details-pagar-na-entrega-nao-espera-pagamento.test.tsx tests/front/order-details-reenviar-comprovante-so-quando-faz-sentido.test.tsx tests/front/order-details-total-pago-so-com-dinheiro-confirmado.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  55 passed (55)
   Duration  12.02s (transform 478ms, setup 105ms, import 291ms, tests 5.68s, environment 4.94s)
```

### Lote 80

`npx vitest run tests/front/order-details-view-financeiro-contraste-aa.test.tsx tests/front/order-details-whatsapp-icone-oficial.test.tsx tests/front/order-list-codigo-de-rastreio.test.tsx tests/front/order-list-contraste-do-card.test.tsx tests/front/order-success-view-convidado-sem-beco.test.tsx tests/front/pagamento-carregamento-tempo-limite.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  21 passed (21)
   Duration  10.12s (transform 608ms, setup 107ms, import 245ms, tests 3.75s, environment 5.00s)
```

### Lote 81

`npx vitest run tests/front/pagamento-cartao-valor-em-centavos.test.tsx tests/front/pagamento-com-cartao-device-id.test.tsx tests/front/pagamento-com-cartao.test.tsx tests/front/pagamento-com-total-zero.test.ts tests/front/pagamento-incompativel-com-frete.test.ts tests/front/pagamento-online.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  141 passed (141)
   Duration  7.23s (transform 359ms, setup 119ms, import 1.12s, tests 1.71s, environment 3.28s)
```

### Lote 82

`npx vitest run tests/front/pagamento-pix-503-passageiro-tem-tentar-de-novo.test.tsx tests/front/pagamento-troca-metodo-guarda-cobranca-incerta.test.tsx tests/front/paineis-e-blocos-alvos-de-toque-l.test.tsx tests/front/painel-avancar-rele-pedido-do-deep-link.test.tsx tests/front/painel-avancar-rele-pedido-mudou.test.tsx tests/front/painel-avisa-o-cliente-com-o-numero-que-ele-ve.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  44 passed (44)
   Duration  10.59s (transform 1.30s, setup 107ms, import 734ms, tests 3.79s, environment 4.96s)
```

### Lote 83

`npx vitest run tests/front/painel-avisa-pedido-pago-e-cancelado.test.tsx tests/front/painel-botao-registrar-pagamento-recebido.test.tsx tests/front/painel-de-pedidos-volta-da-pagina-que-nao-existe-mais.test.tsx tests/front/painel-devolver-agora-desconta-estorno-em-curso.test.tsx tests/front/painel-lista-estorno-devido.test.tsx tests/front/painel-mostra-o-numero-do-pedido-que-o-cliente-ve.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  93 passed (93)
   Duration  15.16s (transform 1.33s, setup 112ms, import 399ms, tests 8.73s, environment 4.92s)
```

### Lote 84

`npx vitest run tests/front/painel-nao-mente-sobre-o-carrinho-da-cliente.test.tsx tests/front/painel-push-de-status-leva-ao-pedido.test.tsx tests/front/painel-retirada-avisa-pronto-para-retirar.test.tsx tests/front/painel-sem-erro-cru.test.ts tests/front/papeis-aria-da-tabela.test.ts tests/front/paralelo-faixas.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  93 passed (93)
   Duration  10.59s (transform 1.36s, setup 118ms, import 240ms, tests 6.57s, environment 2.65s)
```

### Lote 85

`npx vitest run tests/front/paralelo-frente-cli.test.ts tests/front/paralelo-permissoes.test.ts tests/front/pdv-tela-cheia.test.tsx tests/front/pedido-do-cliente-copiar-nao-mente.test.tsx tests/front/pedido-do-cliente-sem-valor-a-pagar.test.tsx tests/front/pedido-em-dobro-morre-na-chave.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  141 passed (141)
   Duration  79.47s (transform 785ms, setup 125ms, import 650ms, tests 75.12s, environment 2.56s)
```

### Lote 86

`npx vitest run tests/front/pedido-mostra-pagamento-confirmado.test.tsx tests/front/pedido-nota-e-rastreio-nao-se-perdem.test.tsx tests/front/pedido-pendente-do-checkout.test.ts tests/front/pedido-pendente-retoma-pagamento.test.tsx tests/front/pedido-presencial-canal-reseta-em-ver-pedidos.test.tsx tests/front/pedido-presencial-filtro-de-canal.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  87 passed (87)
   Duration  13.60s (transform 1.41s, setup 103ms, import 1.04s, tests 6.53s, environment 4.93s)
```

### Lote 87

`npx vitest run tests/front/pedido-presencial-rotulos.test.tsx tests/front/pedido-rastreio-nao-se-perde.test.tsx tests/front/pedido-retirada-na-loja.test.tsx tests/front/pedidos-cabem-no-celular.test.tsx tests/front/pedidos-falam-a-lingua-da-loja.test.tsx tests/front/pedidos-falha-de-leitura-nao-vira-lista-vazia.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  46 passed (46)
   Duration  11.94s (transform 1.52s, setup 104ms, import 749ms, tests 5.20s, environment 4.89s)
```

### Lote 88

`npx vitest run tests/front/pedidos-numeros-do-topo.test.tsx tests/front/pedidos-para-preparar.test.ts tests/front/perfil-botao-sobre-a-loja-todos-os-usuarios.test.tsx tests/front/perfil-busca-pedidos-ao-abrir.test.tsx tests/front/perfil-da-loja-compartilhar.test.tsx tests/front/perfil-enderecos-mapa-por-cartao.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  61 passed (61)
   Duration  16.63s (transform 1.31s, setup 117ms, import 587ms, tests 10.82s, environment 4.12s)
```

### Lote 89

`npx vitest run tests/front/perfil-pedidos-em-andamento-falam-a-verdade.test.tsx tests/front/perfil-retirada-pronta-nao-diz-em-rota.test.tsx tests/front/phone-simulator-estoque-baixo-concorda-singular.test.tsx tests/front/phone-simulator-preco-promocional.test.tsx tests/front/pix-codigo-morto-no-servidor-nao-aparece-como-valido.test.tsx tests/front/pix-copiar-codigo-avisa-se-copiou.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  42 passed (42)
   Duration  12.15s (transform 548ms, setup 112ms, import 860ms, tests 5.23s, environment 4.94s)
```

### Lote 90

`npx vitest run tests/front/pix-qr-god-senior-20260924.test.tsx tests/front/pix-relogio-atrasado-20260924.test.tsx tests/front/politicas-folha-e-links.test.tsx tests/front/politicas-identidade-legal.test.tsx tests/front/politicas-no-checkout.test.tsx tests/front/politicas-peso-do-rodape.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  81 passed (81)
   Duration  10.64s (transform 1.11s, setup 119ms, import 822ms, tests 4.55s, environment 4.16s)
```

### Lote 91

`npx vitest run tests/front/politicas-rodape-da-home.test.tsx tests/front/politicas-voltar-do-aparelho.test.tsx tests/front/porta-de-avisar-clientes-mora-em-clientes.test.tsx tests/front/portas-das-abas-nas-telas.test.tsx tests/front/porteiro-caderneta.test.ts tests/front/porteiro-concordancia.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  56 passed (56)
   Duration  12.48s (transform 1.69s, setup 119ms, import 1.44s, tests 6.55s, environment 3.39s)
```

### Lote 92

`npx vitest run tests/front/porteiro-encaminha-alias.test.ts tests/front/porteiro-ficha.test.ts tests/front/porteiro-fluxo.test.ts tests/front/porteiro-injecao-html.test.ts tests/front/porteiro-matcher.test.ts tests/front/porteiro-middleware-matcher.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  65 passed (65)
   Duration  2.05s (transform 173ms, setup 107ms, import 761ms, tests 171ms, environment 1ms)
```

### Lote 93

`npx vitest run tests/front/porteiro-normalizar-host.test.ts tests/front/porteiro-pastas-publicas.test.ts tests/front/porteiro-resolver-conexao.test.ts tests/front/porteiro-robo-usa-ficha-validada.test.ts tests/front/premium-offers-gate-avaliacoes.test.tsx tests/front/premium-offers-nao-inventa-vendas.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  42 passed (42)
   Duration  4.16s (transform 331ms, setup 115ms, import 703ms, tests 694ms, environment 1.66s)
```

### Lote 94

`npx vitest run tests/front/prepare-identity-build.test.ts tests/front/product-card-gate-avaliacoes.test.tsx tests/front/product-qa-edit-prefill.test.tsx tests/front/product-qa-pergunta-nao-some-quando-o-envio-falha.test.tsx tests/front/product-view-gate-avaliacoes.test.tsx tests/front/produto-barra-desktop-permanece-visivel.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  61 passed (61)
   Duration  14.09s (transform 641ms, setup 120ms, import 1.32s, tests 8.26s, environment 3.38s)
```

### Lote 95

`npx vitest run tests/front/produto-basico-primeiro.test.tsx tests/front/produto-estoque-inteiro.test.tsx tests/front/produto-estoque-minimo.test.tsx tests/front/produto-fala-a-lingua-da-loja.test.tsx tests/front/produto-formulario-letra-e-toque.test.tsx tests/front/produto-formulario-no-celular.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  81 passed (81)
   Duration  37.52s (transform 855ms, setup 104ms, import 403ms, tests 30.94s, environment 5.07s)
```

### Lote 96

`npx vitest run tests/front/produto-novo-cadastrado-avisa-a-lista.test.tsx tests/front/produto-pausado-nao-aparece-na-vitrine.test.tsx tests/front/produto-variacoes-erro-ao-carregar.test.tsx tests/front/produtos-cabem-no-celular.test.tsx tests/front/produtos-detalhado-nao-esconde-o-preco.test.tsx tests/front/produtos-letra-e-toque.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  94 passed (94)
   Duration  13.51s (transform 1.48s, setup 113ms, import 413ms, tests 7.81s, environment 4.17s)
```

### Lote 97

`npx vitest run tests/front/public-store-identity.test.ts tests/front/push-banner-nao-pisa-no-caminho-do-dinheiro.test.tsx tests/front/push-hook-diz-quando-terminou-de-sondar.test.tsx tests/front/push-hook-sem-service-worker.test.tsx tests/front/push-vapid-vem-da-ficha.test.ts tests/front/pwa-precache-wasm-e-chunk-do-leitor.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  54 passed (54)
   Duration  6.17s (transform 272ms, setup 117ms, import 927ms, tests 853ms, environment 3.30s)
```

### Lote 98

`npx vitest run tests/front/qa-stats-erro-nao-e-fila-vazia.test.tsx tests/front/rascunho-do-checkout-dono-do-cupom.test.ts tests/front/rascunho-do-checkout-dono-dos-dados.test.ts tests/front/rascunho-do-checkout.test.ts tests/front/rascunho-init-contra-corrida.test.tsx tests/front/realtime-atualiza-pagamento-sem-sair-da-tela.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  45 passed (45)
   Duration  3.46s (transform 383ms, setup 118ms, import 636ms, tests 60ms, environment 1.65s)
```

### Lote 99

`npx vitest run tests/front/recibo-impresso-endereco-completo.test.tsx tests/front/recibo-impresso-mostra-o-desconto.test.tsx tests/front/recibo-impresso-nome-da-loja.test.tsx tests/front/recuperacao-chunk-contrato-dos-arquivos.test.ts tests/front/recusa-do-pedido-classifica.test.ts tests/front/reembolso-r1-devolucao.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  81 passed (81)
   Duration  6.54s (transform 864ms, setup 114ms, import 613ms, tests 1.56s, environment 3.27s)
```

### Lote 100

`npx vitest run tests/front/retirada-pronta-cancelar-nao-fala-de-devolver-produto.test.tsx tests/front/retirada-pronto-para-retirar-nao-diz-em-transito.test.tsx tests/front/saida-da-recusa-oferece-a-acao.test.tsx tests/front/searchbar-placeholder-e-checkout.test.tsx tests/front/selo-de-frete-gratis-nao-mente.test.tsx tests/front/selo-de-frete-gratis-segue-o-preset.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  68 passed (68)
   Duration  11.54s (transform 1.33s, setup 107ms, import 492ms, tests 5.04s, environment 4.89s)
```

### Lote 101

`npx vitest run tests/front/selo-desconto-verde.test.tsx tests/front/selos-alvos-e-faixas-sem-letra-miuda.test.tsx tests/front/serie-de-14-dias.test.tsx tests/front/shipping-calculator-cache-auto-seleciona-a-mais-barata.test.tsx tests/front/shipping-calculator-cache-cheio-nao-apaga-a-cotacao.test.tsx tests/front/shipping-calculator-cache-contrato-de-cotacao.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  39 passed (39)
   Duration  10.10s (transform 899ms, setup 111ms, import 2.03s, tests 1.86s, environment 5.06s)
```

### Lote 102

`npx vitest run tests/front/shipping-calculator-cache-do-navegador-nao-serve-outro-carrinho.test.tsx tests/front/shipping-calculator-cache-v2-contexto-da-loja.test.tsx tests/front/shipping-calculator-cep-do-endereco-cadastrado.test.tsx tests/front/shipping-calculator-cep-inexistente-diz-cep-nao-encontrado.test.tsx tests/front/shipping-calculator-cotacao-manual-cancela-debounce-pendente.test.tsx tests/front/shipping-calculator-cotacao-pendurada-vira-erro.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  35 passed (35)
   Duration  9.33s (transform 252ms, setup 104ms, import 695ms, tests 2.61s, environment 4.94s)
```

### Lote 103

`npx vitest run tests/front/shipping-calculator-destaques-do-frete.test.tsx tests/front/shipping-calculator-erro-obsoleto-nao-apaga-cotacao-boa.test.tsx tests/front/shipping-calculator-erro-traduzido-nao-mostra-texto-cru.test.tsx tests/front/shipping-calculator-escolha-automatica-cede-a-mais-barata.test.tsx tests/front/shipping-calculator-frete-falado.test.tsx tests/front/shipping-calculator-frete-gratis-fonte-unica.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  22 passed (22)
   Duration  9.03s (transform 300ms, setup 109ms, import 461ms, tests 2.55s, environment 4.91s)
```

### Lote 104

`npx vitest run tests/front/shipping-calculator-invalida-cache-antes-do-debounce.test.tsx tests/front/shipping-calculator-loading-nao-cai-com-resposta-obsoleta.test.tsx tests/front/shipping-calculator-mensagem-offline-nao-diverge.test.tsx tests/front/shipping-calculator-modo-resumo.test.tsx tests/front/shipping-calculator-nao-sobrescreve-com-cotacao-antiga.test.tsx tests/front/shipping-calculator-preco-por-modalidade.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  14 passed (14)
   Duration  8.93s (transform 304ms, setup 107ms, import 509ms, tests 2.38s, environment 4.93s)
```

### Lote 105

`npx vitest run tests/front/shipping-calculator-recota-por-quantidade.test.tsx tests/front/shipping-calculator-retirada-na-loja.test.tsx tests/front/shipping-calculator-selecao-fresca-mesmo-id.test.tsx tests/front/shipping-calculator-sem-preco-inventado.test.tsx tests/front/shipping-progress-contraste-aa.test.tsx tests/front/sino-aviso-de-pergunta-respondida-abre-o-produto.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  27 passed (27)
   Duration  9.32s (transform 293ms, setup 112ms, import 698ms, tests 2.56s, environment 4.95s)
```

### Lote 106

`npx vitest run tests/front/sino-nao-oferece-aba-que-nunca-enche.test.tsx tests/front/sobre-a-loja-iframe-credentialless.test.tsx tests/front/status-da-entrega.test.ts tests/front/status-desconhecido-nao-quebra-a-tela.test.tsx tests/front/status-do-cupom.test.ts tests/front/status-pagamento-pix-termometro.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  75 passed (75)
   Duration  9.76s (transform 1.51s, setup 124ms, import 720ms, tests 4.52s, environment 3.40s)
```

### Lote 107

`npx vitest run tests/front/store-context-nao-mexe-em-dark.test.tsx tests/front/store-delivery-contract.test.ts tests/front/store-identity-draft.test.ts tests/front/store-identity-snapshot.test.ts tests/front/store-identity.test.ts tests/front/sw-atualizacao-so-vale-com-o-app-inteiro.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  206 passed (206)
   Duration  3.22s (transform 384ms, setup 121ms, import 859ms, tests 330ms, environment 852ms)
```

### Lote 108

`npx vitest run tests/front/sw-fetch.test.ts tests/front/sw-icone-neutro-nunca-o-da-principal.test.ts tests/front/sw-identidade-fora-do-document.test.ts tests/front/sw-identidade-navegacao-sem-ficha.test.ts tests/front/sw-identidade-notificacao.test.ts tests/front/sw-nao-guarda-arquivo-privado.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  44 passed (44)
   Duration  6.80s (transform 126ms, setup 113ms, import 87ms, tests 5.55s, environment 1ms)
```

### Lote 109

`npx vitest run tests/front/sw-sem-internet-mostra-pagina-offline.test.ts tests/front/sw-toque-no-aviso.test.ts tests/front/sw-version-json-nao-enche-o-cache.test.ts tests/front/telefone-br-celular-completo.test.ts tests/front/telefone-br-limpar-55.test.tsx tests/front/telefone-br-zero-na-frente.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  84 passed (84)
   Duration  4.77s (transform 203ms, setup 116ms, import 388ms, tests 1.63s, environment 1.65s)
```

### Lote 110

`npx vitest run tests/front/tema-do-painel.test.tsx tests/front/temas-do-painel-cobertura.test.ts tests/front/texto-estoque-baixo-so-restam.test.ts tests/front/tile-de-kpi-superficie.test.tsx tests/front/titulos-pelo-nome-unico-abas.test.ts tests/front/titulos-pelo-nome-unico-telas.test.ts --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  67 passed (67)
   Duration  4.06s (transform 763ms, setup 120ms, import 1.01s, tests 311ms, environment 1.63s)
```

### Lote 111

`npx vitest run tests/front/tons-de-estado.test.ts tests/front/top-products-list-enfeite-contido.test.tsx tests/front/topo-painel-geometria-fixa.test.tsx tests/front/transportadoras-e-minha-loja-alvos-44.test.tsx tests/front/transportadoras-expansivel.test.tsx tests/front/transportadoras-melhor-envio-email-contato.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  45 passed (45)
   Duration  8.37s (transform 485ms, setup 116ms, import 592ms, tests 2.56s, environment 4.11s)
```

### Lote 112

`npx vitest run tests/front/transportadoras-por-provedor-e-ligados.test.tsx tests/front/transportadoras-salvar-e-recarregar.test.tsx tests/front/transportadoras-servico-pelo-nome.test.tsx tests/front/transportadoras-servicos-e-seguro.test.tsx tests/front/transportadoras-teste-de-credenciais.test.tsx tests/front/update-nao-interrompe-checkout.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  67 passed (67)
   Duration  13.18s (transform 373ms, setup 109ms, import 444ms, tests 6.71s, environment 4.92s)
```

### Lote 113

`npx vitest run tests/front/upload-identity-image.test.ts tests/front/use-addresses-lista-compartilhada-entre-telas.test.tsx tests/front/use-busca-cep-aviso-dentro-da-tela.test.tsx tests/front/use-busca-cep.test.tsx tests/front/use-config-do-cartao.test.tsx tests/front/use-coupons-alcance.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  144 passed (144)
   Duration  7.10s (transform 325ms, setup 115ms, import 625ms, tests 1.26s, environment 4.10s)
```

### Lote 114

`npx vitest run tests/front/use-coupons-cupom-preso.test.tsx tests/front/use-coupons-limpar-campo-persiste-como-null.test.tsx tests/front/use-cupons-do-checkout.test.tsx tests/front/use-orders-cancelados-insert-recarrega-com-debounce.test.tsx tests/front/use-orders-cancelados-nao-baixa-o-banco-inteiro.test.tsx tests/front/use-orders-sync-offline-preserva-filtros.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  35 passed (35)
   Duration  6.87s (transform 273ms, setup 104ms, import 293ms, tests 568ms, environment 4.90s)
```

### Lote 115

`npx vitest run tests/front/use-products-upsert-variantes-novas-e-antigas.test.tsx tests/front/useorders-cancelamento-de-cliente-offline-nao-vira-fila.test.tsx tests/front/useorders-falha-de-carregamento-expoe-erro.test.tsx tests/front/varredura-libs-puras.test.ts tests/front/varredura-telas-formatacao.test.tsx tests/front/venda-presencial-fechamento.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  63 passed (63)
   Duration  11.34s (transform 1.56s, setup 115ms, import 1.60s, tests 4.41s, environment 4.19s)
```

### Lote 116

`npx vitest run tests/front/venda-presencial-prazo-da-rede.test.tsx tests/front/vercel-headers-cartao-online.test.ts tests/front/vercel-so-constroi-o-que-vai-ao-ar.test.ts tests/front/verificacao-503-passageiro-pode-verificar-de-novo.test.tsx tests/front/verificacao-do-pagamento-ponto-de-partida.test.tsx tests/front/verificacao-do-pagamento.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  78 passed (78)
   Duration  6.64s (transform 740ms, setup 115ms, import 1.54s, tests 691ms, environment 3.30s)
```

### Lote 117

`npx vitest run tests/front/verificacao-prazo-acabou-so-quem-diz-e-o-servidor.test.tsx tests/front/verify-public-identity-asset.test.ts tests/front/vetos-de-atualizacao/banners.test.tsx tests/front/vetos-de-atualizacao/pdv.test.tsx tests/front/vetos-de-atualizacao/produto.test.tsx tests/front/vetos-de-atualizacao/rascunhos-digitados.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  110 passed (110)
   Duration  13.22s (transform 1.52s, setup 121ms, import 1.04s, tests 7.01s, environment 4.08s)
```

### Lote 118

`npx vitest run tests/front/vitrine-nao-volta-ao-topo-quando-o-estoque-muda.test.tsx tests/front/vitrines-concorrencia-gravacoes.test.tsx --maxWorkers=1`

```text
 Test Files  2 passed (2)
      Tests  19 passed (19)
   Duration  5.21s (transform 848ms, setup 58ms, import 2.01s, tests 1.18s, environment 1.63s)
```

### Lote 119

`npx vitest run tests/front/prepare-identity-image.test.ts tests/front/answers-so-acordam-a-pagina-do-produto.test.tsx tests/front/admin-barra-acoplada.test.tsx tests/front/admin-barra-nao-mente-a-aba-do-pdv.test.tsx tests/front/auth-reset-password-enumeration.test.tsx tests/front/swipe-back-gesto-cancelado-e-timer-pendente.test.tsx --maxWorkers=1`

```text
 Test Files  6 passed (6)
      Tests  123 passed (123)
   Duration  8.70s (transform 711ms, setup 115ms, import 1.23s, tests 2.28s, environment 4.06s)
```

### Lote 120

`npx vitest run tests/front/admin-barra-sem-faixa-solta.test.ts --maxWorkers=1`

```text
 Test Files  1 passed (1)
      Tests  2 passed (2)
   Duration  863ms (transform 125ms, setup 46ms, import 269ms, tests 380ms, environment 0ms)
```

