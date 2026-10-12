# Notas por frente — ondas C, D e E do painel simples

> Complementa `docs/superpowers/plans/2026-10-09-painel-simples.md` (tarefas C1–C14, D1–D12, E1–E5) e a spec
> `docs/superpowers/specs/2026-10-09-painel-simples-design.md`. **Onde este arquivo e o plano divergem, vale este
> arquivo** (ele foi escrito depois de cruzar o plano com o código atual). Manifestos:
> `docs/superpowers/lanes/2026-10-09-painel-simples-ondas-cde-1.json` (7 frentes, em paralelo) e `…-cde-2.json`
> (3 frentes, só depois da integração da onda 1). Respostas assumidas do dono: P1 = A (endereço sem migration),
> P2 = sim (um CEP só), P3 = 5 (só afeta a Onda I, fora deste pedido). **Nenhuma migration, RPC, edge function,
> pagamento ou service worker entra nestas ondas.**

## Regras que valem para TODAS as frentes

- **Tetos exatos.** `tests/front/painel-sem-jargao.test.ts` e `tests/front/regua-visual-do-painel.test.ts` exigem
  contagem IGUAL ao teto. Dentro da frente, a mensagem "baixe o teto para N" nos seus arquivos é ESPERADA; só
  "passou do teto (+K)" é falha. **Não rode `ATUALIZAR_TETOS=1`** (grava JSON compartilhado) e **não edite** os dois
  `.json` de teto: o integrador regrava depois de mesclar. Arquivo novo em `src/views/admin/**` ou
  `src/components/admin/**` nasce com teto 0: código novo ou extraído tem de sair limpo (nada de `text-[≤10px]`,
  `#09090b`, os ouros literais `#FFBF00`/`#e3c25e`/`#e2c04a`, nem `fixed inset-0` sem `role="dialog"`; use
  `bg-admin-bg`, `admin-gold`, texto ≥ 11px, alvo ≥ 44px).
- **Somente leitura em todas as frentes:** `src/config/nomes-do-painel.ts`, `src/components/admin/primitivos/**`,
  `src/config/rotas.ts`, `src/types/index.ts`, `src/App.tsx`, `package.json`, lockfile, `database.types.ts`,
  `.size-limit.cjs`, `.lint-baseline.json`, os `.json` de teto e `tests/front/admin-visual-telas-titulo-padronizado.test.tsx`
  (a asserção global de títulos é do integrador). Precisou de mudança nesses? **PEDIDO no relatório, nunca edição.**
- **Não altere estas linhas literais** (testes de fonte as leem): `import { AdminPageHeader } from
  "@/components/admin/AdminPageHeader";` e `import { pixConfiguradoNoBuild } from "@/lib/pix-configurado-no-build"`
  em `AdminDashboardView` e `AdminSettingsView`.
- **Testes na sua posse "por segurança"** (os que só renderizam a tela tocada): edite só se quebrarem; asserção de
  COMPORTAMENTO não sai (dirty, nada desmonta, payload, navegação). Não renomeie "Guia de Controle de Pedidos" nem
  "Guia de Ajuda e Explicações" (o teste `admin-orders-guia-do-pagamento-que-nao-fechou` depende deles).
- **Título pelo nome único:** o `titulo` do `AdminPageHeader` passa a vir de `NOMES_DO_PAINEL["admin-…"]`
  (Novo/Editar produto e cupom: verbo + substantivo de `NOMES_DO_PAINEL`). Cada frente prova os títulos das SUAS
  telas em teste novo da sua posse. Títulos de ajuda (`AdminHelpModal`) pelo glossário (`src/lib/glossario-do-painel.ts`).
- **Commits:** `node scripts/paralelo/frente.mjs commitar -m "<assunto>"` DESCARTA o corpo da mensagem; tudo bem,
  o integrador carrega a atribuição. Formatação é do **Biome** (`npx biome check --write <seus arquivos>`), não
  Prettier. Antes de reportar rode `CI=true npm run lint:ratchet` e cole a saída (eslint 451 / biome 15 / sem
  "SUBIU"): as duas ondas anteriores reprovaram a catraca por warnings novos (`security/detect-object-injection`
  em chave tipada → `// eslint-disable-next-line security/detect-object-injection -- chave tipada, não entrada
  de usuário`; teste que lê arquivo → `security/detect-non-literal-fs-filename` com motivo).
- **Typecheck com exit real:** `npm run typecheck; echo exit=$?` (sem pipe para `tail`, que mascara o exit).
- Não rode `npm test` inteiro. Teste escopado + typecheck + ratchet + `frente.mjs conferir`.
- Frente RISCO (`devolucao-mesmo-endereco`, pelo caminho `*devolu*`) leva `revisor-risco`.

---

## ONDA 1

### 1. portas-e-alternador — C1, C2, C3, C4 + título de Produtos, Pedidos, Clientes, Perguntas, Avaliações
- `AtalhosDaAba` (já existe em `primitivos/`) entra em Produtos (`aba="produtos"`: só a porta **Cupons**),
  Pedidos (`aba="pedidos"`: só **Devoluções**; Avaliações e Perguntas saem de Pedidos) e Clientes
  (`aba="clientes"`: **Perguntas e avaliações** → `admin-qa` e **Avisar clientes** → `admin-push`; some a porta
  "Canais de Atendimento"). Apague `dashboard/ProductBanners.tsx`, `SupportBanners.tsx`, `CustomerBanners.tsx`
  (confirme com `rg -n "ProductBanners|SupportBanners|CustomerBanners" src tests` que nada mais os importa).
- `AlternadorDeTelas` (Perguntas | Avaliações) logo abaixo do cabeçalho de `AdminQAView` e `AdminReviewsView`:
  clicar na outra chama `onNavigate` com a rota dela.
- `porta-de-avisar-clientes-mora-em-clientes.test.tsx` hoje importa `CustomerBanners` (apagado): reescreva contra
  `AdminCustomersView`/`AtalhosDaAba`: "Perguntas e avaliações" → `admin-qa`; "Avisar clientes" → `admin-push`;
  NÃO há porta para `admin-whatsapp-config` em Clientes. **A metade "Ajustes NÃO tem porta para admin-push;
  banners e vitrines continuam alcançáveis" sai deste arquivo** e renasce em `ajustes-grupos-e-portas.test.tsx`
  (frente `ajustes-grupos`): o revisor confere as duas pontas para nenhuma asserção se perder — não a apague
  sem a outra frente tê-la; deixe-a como está até migrar e relate.
- Testes novos: `portas-das-abas-nas-telas.test.tsx` (opcional se renderizar as telas ficar pesado),
  `perguntas-e-avaliacoes-alternam.test.tsx`, `titulos-pelo-nome-unico-abas.test.ts` (fonte: `NOMES_DO_PAINEL[…]`
  no `titulo` das 5 telas). `atalhos-da-aba.test.tsx`: casos novos (Produtos tem Cupons e nenhuma porta para
  `admin-shipping`; Pedidos tem Devoluções e nenhuma para qa/reviews).
- Atenção: a porta de Frete sai de Produtos; Ajustes ganha a dela na frente `ajustes-grupos` (mesma onda).
- Vizinhas: `ajustes-grupos`, `voltar-e-layout` (pai de qa/reviews vira Clientes), `titulos-restantes`,
  `minha-loja-e-passos`, `enderecos-leem-da-loja`, `devolucao-mesmo-endereco` (não toque).
- Verificação: `npx vitest run tests/front/atalhos-da-aba.test.tsx tests/front/perguntas-e-avaliacoes-alternam.test.tsx tests/front/porta-de-avisar-clientes-mora-em-clientes.test.tsx tests/front/titulos-pelo-nome-unico-abas.test.ts` + os `admin-orders-*`, `admin-products-*`, `admin-customers-*`, `admin-qa-*`, `admin-reviews-*` da sua posse que a mudança tocar.

### 2. ajustes-grupos — C5 + título de Ajustes
- Constante dos 6 grupos em `src/components/admin/settings/grupos-de-ajustes.ts`, lida pela tela E pela ajuda
  (some o "três grupos"): **Minha loja** (porta para `admin-about-store`), **Aparência do app** (Banners, Vitrines),
  **Entrega e frete** (porta para `admin-shipping` — hoje NÃO existe em Ajustes; sem ela o Frete fica sem porta
  depois que a frente 1 a tira de Produtos), **Pagamentos**, **Regras de troca e devolução** (era "Pós-venda"),
  **Ferramentas**.
- As portas continuam cartões locais com nome e rota de `NOMES_DO_PAINEL`/`PORTAS_DO_PAINEL`; **não use
  `AtalhosDaAba`** (desenha lista plana). Renomeie o acordeão interno "Entrega e frete" para **"Transportadoras"**
  (colide com o nome do grupo). O cartão "Como está sua loja" FICA até a E5 (onda 2).
- Testes: `admin-ajustes-salao-e-porao` (ordem e nomes dos grupos; "Sobre a Loja" → "Minha loja"),
  `admin-settings-secoes-colapsaveis` ("Banners Promocionais"/"Vitrines (Carrosséis)" → "Banners"/"Vitrines";
  nome do acordeão de transportadoras), `ajustes-identidade-e-horario-so-em-sobre-a-loja` (a porta "Sobre a Loja"
  → "Minha loja"; o 2º caso é da Minha loja e NÃO se mexe), `ajustes-grupos-e-portas.test.tsx` (novo: recebe a
  metade Ajustes do `porta-de-avisar`, a ajuda lista os mesmos grupos que a tela, título de `NOMES_DO_PAINEL`).
- `PoliticaDeDevolucaoSection` é montada aqui mas é da frente `devolucao-mesmo-endereco`: não a edite.
- Vizinhas: `portas-e-alternador`, `devolucao-mesmo-endereco`, `minha-loja-e-passos`.
- Verificação: `npx vitest run tests/front/ajustes-grupos-e-portas.test.tsx tests/front/admin-ajustes-salao-e-porao.test.tsx tests/front/admin-settings-secoes-colapsaveis.test.tsx tests/front/ajustes-identidade-e-horario-so-em-sobre-a-loja.test.tsx tests/front/ajustes-disclosure-do-diagnostico.test.tsx tests/front/admin-settings-pix-acompanha-o-interruptor.test.tsx tests/front/formas-de-pagamento-secao-admin.test.tsx`.

### 3. voltar-e-layout — C6, C7 (só o arquivo novo), C8, C9
- C6: `src/utils/pai-da-tela-do-admin.ts`: `admin-qa`/`admin-reviews` → `admin-customers`; `admin-shipping` →
  `admin-settings`; `admin-whatsapp-config` sem origem → `admin-settings`; `admin-push` sem origem →
  `admin-customers`. Atualize `pai-da-tela-do-admin.test.ts` (fallback do push, do whatsapp, qa, comentário do topo).
- C7: **só** `src/utils/volta-do-navegador-no-painel.ts`: `destinoDoPopstate(view: View): View | null` devolve
  `paiDaTelaDoAdmin(view, null, false)`, trocando `"profile"` por `null` (abas raiz → `null`; `admin-notifications` →
  `admin-dashboard`), + `tests/front/voltar-do-navegador-segue-o-pai.test.ts` (percorra todas as chaves de
  `NOMES_DO_PAINEL`). **A edição do `src/App.tsx` (~1765-1880) e o teste de fonte sobre o App são PEDIDOS do integrador.**
- C8: `AdminArea.tsx`, `AdminViewLoadingFallback` usa `NOMES_DO_PAINEL` (somem "Campanha", "Suporte Q&A",
  "Frete nacional", "Detalhes", "Dashboard CRM"): `carregando-usa-nome-do-painel.test.tsx` (novo).
- C9: `AdminLayout.tsx`: sem botão "Avisar clientes" na barra lateral (~966-984); subcabeçalhos de banners e vitrines
  (~1124-1170) dizem "Banners" e "Vitrines"; "Notificações" continua: `admin-layout-porta-unica.test.tsx` (novo).
- O realce de aba muda (qa/reviews acendem Clientes; shipping acende Ajustes): confira os testes de layout da sua posse.
- Vizinhas: `portas-e-alternador`, `ajustes-grupos`. Não toque `App.tsx`.
- Verificação: `npx vitest run tests/front/pai-da-tela-do-admin.test.ts tests/front/voltar-do-navegador-segue-o-pai.test.ts tests/front/carregando-usa-nome-do-painel.test.tsx tests/front/admin-layout-porta-unica.test.tsx tests/front/sino-do-painel-leva-as-notificacoes.test.tsx tests/front/sino-do-painel-acende-quando-consulta-falha.test.tsx tests/front/admin-pdv-registro-no-roteador.test.tsx tests/front/admin-barra-nao-mente-a-aba-do-pdv.test.tsx tests/front/admin-barra-tem-nome-acessivel.test.tsx tests/front/admin-cabecalho-alvos-44.test.tsx tests/front/admin-layout-badge-de-ajustes-nao-mente.test.tsx tests/front/admin-layout-cracha-pedidos-pendentes.test.tsx`.

### 4. titulos-restantes — C10 (só Início), C11 (Cupons, Cupom), C12 (Banners, Vitrines, Avisar clientes, Notificações), C13 (Produto, Ficha do cliente, Vender), C14 (Relatórios, Financeiro)
- Trocas reais: "Dashboard CRM" → **"Relatórios"** em `AdminCrmView:166`, `AtalhosDoInicio.tsx:14`, texto da ajuda em
  `AdminDashboardView:~331` e `AjudaDoCrm.tsx:26`; título da ajuda `AjudaDoCrm.tsx:22` ("Central de Inteligência &
  KPIs") → "Como ler os relatórios"; "Gerenciador de Banners" → "Banners"; "Enviar Notificações" → "Avisar clientes";
  "Perfil do Cliente" → "Ficha do cliente"; "Novo/Editar Produto|Cupom" → "Novo produto"/"Editar produto"/"Novo
  cupom"/"Editar cupom" com o substantivo vindo de `NOMES_DO_PAINEL`; ajuda "Engenharia & Cadastro de Produtos" →
  "Como cadastrar um produto"; ajudas de Banners e Vitrines saem do glossário proibido.
- `AdminDashboardView` nesta onda só ganha o título e o texto da ajuda (o cartão do Início é da onda 2/`cartao-guiado`
  e `loja-pronta.ts` é da frente 5).
- Dos 13 testes que citam "Dashboard CRM" só `atalhos-do-inicio-so-dois-botoes-grandes` (37-59) e `inicio-do-painel`
  (255-260) afirmam o texto; `admin-push-cabecalho-nao-estoura-no-mobile` (143), `admin-visual-canais-avisar` (373, só
  o bloco Avisar clientes), `ajuda-do-dashboard-descreve-os-kpis-da-tela` (174) também mudam. `crm-do-painel` (455): só
  se renomear o botão "Guia de Ajuda e Informações" — NÃO recomendado.
- Teste novo: `titulos-pelo-nome-unico-telas.test.ts` (fonte, para as suas telas).
- Vizinhas: `voltar-e-layout` (subcabeçalho de Banners no `AdminLayout` é dela), `minha-loja-e-passos` (título do
  Início NÃO; o título de Minha loja é dela).
- Verificação: `npx vitest run tests/front/titulos-pelo-nome-unico-telas.test.ts tests/front/atalhos-do-inicio-so-dois-botoes-grandes.test.tsx tests/front/inicio-do-painel.test.tsx tests/front/ajuda-do-dashboard-descreve-os-kpis-da-tela.test.tsx tests/front/crm-do-painel.test.tsx tests/front/admin-push-cabecalho-nao-estoura-no-mobile.test.tsx tests/front/admin-visual-canais-avisar.test.tsx` + os demais da sua posse que a tela tocada exigir.

### 5. minha-loja-e-passos — D1, D2, D3, D4, D5, E1 + título "Minha loja" + destino do item CEP
- D1 `src/lib/endereco-da-loja.ts` (puro): `montarEnderecoDaLoja`, `lerEnderecoDaLoja` (inverso exato; texto livre
  antigo → `null`), `divergenciaDoEndereco` (ignora acento/maiúscula). Formato do CEP gravado = o de hoje
  (`formatCEP`; confira em `FreteNacionalBloco.tsx`). Texto: `"Rua, nº[, compl.] — Bairro, Cidade/UF — CEP 00000-000"`.
- D2 `minha-loja/EnderecoDaLoja.tsx` (usa `useBuscaCep` e `LocalBufferedInput`): CEP preenche rua/bairro/cidade/UF;
  sem número o Salvar fica desabilitado COM o motivo à vista; `onMudou` entrega as 4 chaves (`originCep`,
  `storeAddress`, `storeCity`, `storeState`); endereço antigo ilegível aparece como texto com "Confirme pelo CEP";
  CEP inexistente → "CEP não encontrado" sem apagar o que estava; aviso ESTÁTICO do Melhor Envio ("as etiquetas saem
  com o endereço da sua conta Melhor Envio — confira se é este mesmo").
- D3 `AdminAboutStoreView.tsx`: um Salvar = **uma** chamada `updateConfig` com `originCep`, `storeAddress`,
  `storeCity`, `storeState` e `storeDescription`; toast de erro pelo `erro-do-painel`. D4: aviso de divergência CEP × cidade.
- D5: `IdentitySettingsSection` sem Cidade/UF nos campos visíveis, **sem reverter** a cidade gravada pelo Endereço e
  sem conflito de revisão. **`src/lib/adminStoreIdentity.ts` NÃO é da sua posse**; se precisar mudar, PARE e escale
  (vira RISCO). Cidade/UF continuam no pacote de 8 chaves da `save_store_identity` (a RPC recusa pacote incompleto);
  a tela de conflito (`IdentitySettingsSection.tsx:~383`, mesma lista `fields`) tem de continuar comparando
  `store_city`/`store_state` mesmo com os campos escondidos; teste `minha-loja-marca-nao-reverte-cidade`.
- E1: em `src/lib/loja-pronta.ts` **ADICIONE exports novos, sem tocar nos antigos** (o cartão usa
  `Record<ChaveDoPasso, …>`; mudar no lugar quebra o typecheck): `seisPassosDaLojaPronta`, `proximoPasso`,
  `contagemDosPassos` (`{feitos, total: 6}`), tipo `ChaveDosSeisPassos`, montador `entradaDosSeisPassos(config,
  fatos)` (usa `lerEnderecoDaLoja` e `lojaTemWhatsapp`). Itens: marca, endereço (CEP + número), WhatsApp, recebe,
  entrega, produto; horário NÃO conta. O item "entrega" chega como FATO pronto (`EstadoDoItem`) calculado por quem
  chama (régua da E2 está na frente 6). Único campo antigo que muda: o `destino` do item CEP →
  `admin-about-store` (atualize `dashboard-diz-o-que-falta-para-vender` 274-298 e `dashboard-cep-oito-digitos` 76).
- `AdminWhatsAppConfigView.tsx` está na sua posse só para trocar "Alterar em Sobre a Loja" por "Alterar em Minha
  loja" (1 linha; atualize `atendimento-nao-grava-horario`); NÃO extraia nada dele agora (D9–D11 são da onda 2).
- Testes: novos `endereco-da-loja.test.ts`, `minha-loja-endereco-por-cep.test.tsx`,
  `minha-loja-marca-nao-reverte-cidade.test.tsx`; `admin-sobre-a-loja-salva-sem-apagar` (caso D3: 1 chamada com 5
  chaves, D4, título); `loja-pronta.test.ts` (seis passos, destino 45-46); `admin-settings-identidade-da-loja`
  (270-290 digitam `store-city`/`store-state`); `identity-settings-section` (585-596); `guarda-de-cor-sai-junto-com-a-escrita`;
  `tests/browser-identity-editor/run.mjs` e `entry.tsx` (934: foco depois de `#store-name`; 1083-1110: outro ator
  muda a cidade — verificação manual fora do CI, mas acompanha). NÃO edite `about-store-view-*` (página pública da
  cliente). 2º caso de `ajustes-identidade-e-horario-so-em-sobre-a-loja` (manter `#store-name` e
  `#store-business-hours`): só leitura.
- Risco: ROTINA, **destaque D5** (revisor confere o pacote de 8 chaves e a re-leitura sem conflito).
- Vizinhas: `enderecos-leem-da-loja` (Frete para de gravar o CEP), `devolucao-mesmo-endereco` (lê `storeAddress`),
  `ajustes-grupos` (porta "Minha loja"), `titulos-restantes` (título do Início).
- Verificação: `npx vitest run tests/front/endereco-da-loja.test.ts tests/front/minha-loja-endereco-por-cep.test.tsx tests/front/minha-loja-marca-nao-reverte-cidade.test.tsx tests/front/loja-pronta.test.ts tests/front/dashboard-diz-o-que-falta-para-vender.test.tsx tests/front/dashboard-cep-oito-digitos.test.tsx tests/front/admin-sobre-a-loja-salva-sem-apagar.test.tsx tests/front/identity-settings-section.test.tsx tests/front/admin-settings-identidade-da-loja.test.tsx tests/front/ajustes-identidade-e-horario-so-em-sobre-a-loja.test.tsx`.

### 6. enderecos-leem-da-loja — D6, D7, E2 + título "Entrega e frete"
- D6: tire `originCep` do `formData` inteiro de `AdminShippingView` (linhas ~172, 243, 425, 575, 784-786); o Salvar do
  Frete chama `updateConfig` **sem** `originCep`. `FreteNacionalBloco` ganha prop SÓ de leitura com outro nome
  (`cepDaLoja`, para a guarda da D12 não confundir) e mostra "Entregas saem de: CEP 01310-100" + botão "Alterar em
  Minha loja" → `onNavigate("admin-about-store")`; sem CEP, o aviso "sem isso a loja não vende" leva a Minha loja.
  O texto "Configure abaixo" do status local passa a apontar para Minha loja.
- D7: `FreteLocalBloco` ganha `onNavigate`; sem `storeAddress` a chave de retirada explica e oferece "Cadastrar
  endereço em Minha loja"; com endereço, mostra o endereço só para leitura (confirme com `rg -n "store-pickup|Retirada"`).
- E2: extraia `StatusDaFaixaFrete` (~320 de `AdminShippingView`) para `src/lib/status-da-entrega.ts` (mesmos casos: sem
  CEP; local; nacional com/sem transportadora). O TIPO `StatusDaFaixaFrete` continua em `FreteResumoFaixa.tsx` (a lib
  importa por `import type`): remover o `export interface` dispara a heurística de "export removido".
- Testes: novos `frete-nao-grava-cep.test.tsx` (inclui título "Entrega e frete") e `status-da-entrega.test.ts`;
  inverter a asserção de `originCep` no payload em `admin-visual-frete` (164-179), `admin-shipping-frete-unificado`
  (339) e `admin-shipping-national-view` (521); `admin-shipping-trocar-de-aba` (122, `#origin-cep`);
  `admin-shipping-nao-inventa-cep-de-origem`; `admin-frete-v2-contrato` (519); `admin-frete-nacional-botao-abre-tela`
  (props do bloco); `admin-frete-retirada-na-loja` (273, "Sobre a Loja"). `…estrategia-nacional-na-faixa` deve
  continuar verde SEM edição. NÃO toque `frete-indefinido-sem-cep-de-origem` (é da cliente) nem
  `dashboard-diz-o-que-falta-para-vender` (é da frente 5).
- Vizinhas: `minha-loja-e-passos`, `ajustes-grupos`, `voltar-e-layout` (pai de `admin-shipping` vira Ajustes).
- Verificação: `npx vitest run tests/front/frete-nao-grava-cep.test.tsx tests/front/status-da-entrega.test.ts tests/front/admin-shipping-nao-inventa-cep-de-origem.test.tsx tests/front/admin-visual-frete.test.tsx tests/front/admin-frete-v2-contrato.test.tsx tests/front/admin-frete-retirada-na-loja.test.tsx tests/front/admin-frete-nacional-botao-abre-tela.test.tsx tests/front/admin-shipping-frete-unificado.test.tsx tests/front/admin-shipping-national-view.test.tsx tests/front/admin-shipping-view-estrategia-nacional-na-faixa.test.tsx tests/front/admin-shipping-trocar-de-aba-nao-apaga-o-que-foi-digitado.test.tsx`.

### 7. devolucao-mesmo-endereco — D8 + título "Devoluções" (RISCO pelo caminho `*devolu*` → `revisor-risco`)
- `PoliticaDeDevolucaoSection.tsx` passa a ler `config.storeAddress` por `useStore()` (sem prop nova). Com
  `endereco_devolucao` vazio a caixa "Mesmo endereço da loja" vem MARCADA mostrando o endereço (sem campo);
  desmarcar mostra o campo; remarcar e salvar envia `endereco_devolucao: ""` (a semântica de hoje; o payload da RPC
  `salvar_politica_de_devolucao` NÃO muda). `AdminDevolucoesView`: título por `NOMES_DO_PAINEL`.
- Testes: `devolucao-mesmo-endereco-da-loja.test.tsx` (novo), `devolucao-politica-no-painel` (hoje SEM mock de
  `@/contexts/StoreContext`: ganha o mock e a caixa no lugar do campo vazio), `devolucoes-titulo-pelo-nome-unico.test.ts` (novo).
- Vizinhas: `ajustes-grupos` (monta a seção), `minha-loja-e-passos`.
- Verificação: `npx vitest run tests/front/devolucao-mesmo-endereco-da-loja.test.tsx tests/front/devolucao-politica-no-painel.test.tsx tests/front/devolucoes-titulo-pelo-nome-unico.test.ts tests/front/devolucao-liberar-vinculo-reverso.test.tsx tests/front/devolucao-painel-concluir-estorna.test.tsx tests/front/devolucao-painel-etiqueta-reversa-avisos.test.tsx`.

---

## ONDA 2 (só depois da integração da onda 1)

### A. contato-e-atendimento — D9, D10, D11, D12, E4
- D9: `minha-loja/WhatsAppDaLoja.tsx` e `MensagemDeCompartilhar.tsx` extraídos de `AdminWhatsAppConfigView` (blocos
  1 e 3), MESMO comportamento (10–11 dígitos → `55…`, vazio grava NULL, "WhatsApp inválido", modelos abrem/fecham).
  Código extraído sai LIMPO (teto 0). D10: `secaoInicial?: "contato"` em `AdminAboutStoreView`. D11: `AdminArea`
  `case "admin-whatsapp-config"` renderiza `AdminAboutStoreView` com `secaoInicial="contato"`; apague
  `AdminWhatsAppConfigView.tsx`; também `src/hooks/usePrefetchOnHover.ts:53-54` importa a view. Verificação `rg -n
  "views/admin/AdminWhatsAppConfigView" src` vazio (não o `rg` genérico: há comentários da cliente). D12: guarda
  `endereco-e-horario-tem-um-dono.test.ts` (só chave de objeto passada a `updateConfig`; ignore `readonly originCep:`
  de interface). E4: "Falta preencher: …" no topo de Minha loja, o toque leva ao bloco.
- Testes que migram para os componentes novos SEM perder asserção de comportamento: `atendimento-presets-abre`,
  `admin-whatsapp-folha-modelos-fecha`, `atendimento-formulario-direto`, `admin-visual-canais-avisar` (bloco Canais
  de Atendimento; o contrato de fonte "o glob casou as duas telas"), `atendimento-nao-grava-horario`,
  `nome-da-loja-whatsapp`, `ajustes-horario-de-atendimento`.
### B. cartao-guiado — E3
- Cartão do Início nos seis passos: "4 de 6 prontos", UM botão "Próximo passo: …", lista recolhida (`aria-expanded`),
  6/6 → só "Loja pronta para vender". O item "entrega" no Início usa só o que é barato (a parte local/CEP); a régua
  completa mora no Frete (`status-da-entrega`). Pode remover a função antiga de 3 itens (o heurístico de "export
  removido" pedirá `revisor-risco`; só o cartão a usa — ou adie a remoção). **Não mude as assinaturas novas** (E4 e
  E5 as usam em paralelo).
### C. ajustes-status — E5
- Troca o cartão "Como está sua loja" por subtítulo de status em cada grupo (mesma função dos seis passos; "Falta:
  WhatsApp", "Na entrega + PIX"); "Conexão" vai para Ferramentas ("Minha loja está no ar?").

---

## Pedidos do integrador (onda 1), na ordem

1. `integrar` as 7 frentes na ordem do manifesto.
2. **C7 em `src/App.tsx`:** trocar o bloco ~1763-1877 (lista `subAdminViews` + cadeia if/else) por
   `const pai = destinoDoPopstate(currentViewRef.current); if (pai !== null && !targetView.startsWith("admin")) { targetView = pai; history.replaceState({ view: pai }, "", `/${pai}`); }` + import de
   `@/utils/volta-do-navegador-no-painel`; e o teste de fonte (o fonte não contém `currView === "admin-coupon-form"`
   e contém `destinoDoPopstate(`). Rodar `voltar-do-navegador-segue-o-pai`, `pai-da-tela-do-admin`,
   `rotas-de-entrada` (43/24), `hospedagem-rotas` (67/134), `app-popstate-camada-antes-do-dirty`,
   `app-aba-ativa-com-formulario-sujo-nao-desliga-a-guarda`, `admin-pdv-registro-no-roteador`.
3. Asserção global em `admin-visual-telas-titulo-padronizado.test.tsx` (regex "contém", exceções:
   `AdminWhatsAppConfigView`, `AdminShippingNationalView`, `AdminLoginView`, `AlertasCancelados`, `StatusPagamentoPix`).
4. `ATUALIZAR_TETOS=1` nos dois testes de guarda; `.lint-baseline.json` se o ratchet disser que algo caiu.
5. Remover os worktrees das frentes e rodar o `/checar` completo uma vez, com `build` e `size`.
