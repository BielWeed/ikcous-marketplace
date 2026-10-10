# Notas por frente — ondas G e H do painel simples

> Complementa `docs/superpowers/plans/2026-10-09-painel-simples.md` (tarefas G1–G10, H1–H6). **Onde este arquivo e o plano divergem, vale este arquivo** (escrito depois de cruzar o plano com o código de 509ca588). Manifestos: `docs/superpowers/lanes/2026-10-09-painel-simples-ondas-gh-3.json` (9 frentes em paralelo) e `…-gh-4.json` (2 frentes, só depois da integração da 3). Respostas assumidas do dono (recomendações do planejador aceitas): P1 'Resultado' / 'Mês de referência'; P2 um status do PIX só; P3 sem destinos novos no aviso; P4 sem tabela fixa de serviços do Melhor Envio; P5 a Onda F fica para depois de H.

## 0. O que o código de hoje (509ca588) muda no plano

Reconferi cada tarefa no código.

**Partição ajustada, e por quê:**
- `dashboard/OperationalPerformanceChart.tsx`, `StrategicIntelligenceBlocks.tsx` e `TopProductsList.tsx` foram para **crm**. São montados por `crm/VisaoGeralDoCrm.tsx:3-5`, e é lá que mora o "ROI do Estoque".
- `inicio/NumerosDoMes.tsx` também foi para **crm**: importa `src/lib/crm.ts`, que é da crm.
- `PhoneSimulator.tsx` foi para **produto**: é importado por `AdminProductFormView:8`.
- `GuiaDaChaveDoProvedor.tsx` foi para **frete-cards**: é importado por `TransportadorasCard:1`.
- `pdv/CupomDaVenda.tsx` foi para **pedidos-e-dinheiro**: o caminho casa `*cupom*`, ou seja, dinheiro.
- O "resto do jargão" virou 2 frentes que não colidem:
  - **pedidos-e-dinheiro**: AlertasCancelados, Guia do pagamento que não fechou, EstornoCard, OrderDetail, AdminOrdersView, CupomDaVenda. Têm de andar juntos porque o teste `admin-orders-guia-do-pagamento-que-nao-fechou` lê o fonte de EstornoCard, AlertasCancelados e OrderDetail e cobra que cada rótulo citado pelo guia exista no arquivo que o desenha (linhas 346-421).
  - **clientes-e-catalogo**: Customers, UserDetail, Products, QA.
- `BusinessHoursSection` (teto 2) não entra em frente nenhuma. As 2 ocorrências são o identificador `lerSupabaseUrl` (import na linha 3, `key` na linha 145), que fica como resíduo.

**Tarefas já feitas ou que mudaram de forma:**
- **G1:** o CRM não tem aba "Estoque". As abas são Visão geral, Clientes, Canais e Funil e pedidos.
  - "Conversão Comercial" não é do CRM: está em `AdminQAView.tsx:474`, então vai para clientes-e-catalogo.
  - Os segmentos já têm descrição. Os rótulos com jargão estão em `src/lib/crm.ts:400-460` (`infoDoSegmento`), fora da varredura da guarda.
- **G2:** "Contas e categorias" já é a última aba (`AdminFinanceiroView.tsx:76-83`). Falta só o selo "Avançado".
- **G5:**
  - Os cabeçalhos já estão em português ("Destino / Transportadora / Motivo").
  - Falta "Destino" → "CEP do cliente".
  - O nome do provedor sai cru (`replace("_"," ")` + `capitalize`, linha 223).
  - O motivo às vezes é o corpo bruto da API do provedor (comentário nas linhas 58-65).
- **G6:**
  - A lista crua de códigos "Salvos nesta loja" saiu em 23/09 (`TransportadorasCard.tsx:1577-1579`).
  - A lista de serviços já mostra o nome que vem de `list_services`.
  - Os ids 12/15/16/22 só alimentam o aviso de agência (linhas 117-122).
  - O único código cru que resta é o resultado do "Testar" (linhas 1535-1537: `{s.codigo} (nome): …`).
- **G7:** o selo do `AdminLayout` já diz "Offline / Sincronizado / Lento / Online" (linhas 816-822). Sobram o `title` "Latência: Nms" (778), o `text-[7px]` (812) e o texto do `PontoDeOperacao.tsx:61-84`.
- **G9:** os ícones já estão num `<details>` montado ("Mais imagens da loja…", `IdentitySettingsSection.tsx:241-254`).
- **G10:** o padrão de busca do plano não acha nada hoje em `src/views/admin` nem em `src/components/admin`. O `mensagemAmigavel` citado no plano não existe: a função é `mensagemDeErroDoPainel(erro, acao)`. Ela só deixa passar o SQLSTATE 22023 e trocaria por frase genérica as mensagens em português que as RPCs levantam com P0001 (ex.: `registrar_pagamento_recebido`: "Pedido cancelado não recebe pagamento."). Detalhe na onda 4.
- **H1:**
  - Não existe campo de SEO no Produto.
  - A Descrição é obrigatória (`src/utils/motivo-do-bloqueio-do-produto.ts:30`), então fica no Básico, não recolhida.
  - Não existe erro de validação em "Peso e medidas". O H1b prova com erro de custo ou de código interno.
  - O `abertaInicial` do `SecaoRecolhivel` só vale na montagem, e o corpo monta antes de o produto carregar (efeito em ~861-938).
- **H3:** o destino já é escolhido por lista (Select com 8 opções, `AdminPushView.tsx:1407-1451`). Falta tirar "Outra Página (Link manual)" da lista e levar o campo para Avançado.
- **H4:** Simples já é o padrão (linhas 719 e 1443). Ao editar, o modo é deduzido do banner (1399-1404).
  - **Perigo de dado:** salvar em Simples APAGA título, subtítulo, botão, selo, cores e fonte (1695-1705).
  - Por isso, lembrar o modo só pode valer para banner novo ou banner sem texto.
- **H5:**
  - Em Ajustes, o acordeão hoje se chama "Transportadoras", dentro do grupo "Entrega e frete" (`AdminSettingsView:910-920`).
  - "Consultas de frete" está no grupo Ferramentas (1074-1080).
  - O "lazy" do plano não faz sentido: `AdminShippingView` já importa `TransportadorasCard` de forma estática (linhas 8-10).
- **F (F1–F7) não foi feita.** F3 tira o "Ticket Médio" de Pedidos; F4 e F6 tocam NumerosDoMes, AdminCustomersView e AdminUserDetailView (ver P5).

## 2. Notas por frente — ONDA 3

### Regras que valem para TODAS as frentes

Valem inteiras as regras de `docs/superpowers/plans/2026-10-09-painel-simples-ondas-cde-notas.md` (tetos exatos, somente-leitura, linhas literais, testes por segurança, títulos, commits pelo `frente.mjs commitar`, Biome, typecheck com exit real, não rodar `npm test` inteiro, frente RISCO leva `revisor-risco`). O que muda ou se soma:

- **Catraca de hoje:** eslint 410 / biome 14 (`.lint-baseline.json`). A nota antiga dizia 451/15.
- **Nenhum export muda de assinatura.** Vale para:
  - `src/lib/crm.ts` (o Início lê);
  - `src/lib/financeiro.ts`;
  - os exports de `TransportadorasCard` (onda 4 e Frete dependem deles);
  - `urlDeNotificacoesDoWebhook` e `CARTAO_PELO_APP`;
  - `erroDoArrependimento` e `erroDoVicio`.
- **Identificador não é texto.** Não renomeie export nem campo que vai a RPC/tabela só para baixar a guarda (`dataCompetencia`, `lerSupabaseUrl`, `urlDeNotificacoesDoWebhook`). Identificador interno, não exportado, pode ser renomeado. O resíduo vai no relatório, linha a linha.
- **Comentário em bloco JSX conta como código.** Linha que continua um `{/* … */}` sem começar com `*` ou `//` é contada pela guarda (ex.: `AdminUserDetailView:492,504,772`, `AlertasCancelados:344`). Reescreva o texto pelo glossário.
- **Termo técnico entre parênteses ainda conta na guarda.** Use-o só como ponte com texto que esta onda não pode mudar:
  - mensagens da edge `credenciais-mercado-pago` ("Access Token", "Chave de notificações");
  - mensagens de `src/hooks/useProducts.ts:327-493` ("SKU");
  - nomes que aparecem na tela do Mercado Pago, no prompt.
- **Régua visual:** nunca subir; baixar onde tocar.
  - Cor que é DADO nunca vira token: cores padrão do banner (`#FFBF00` em `AdminBannersView:785,834-836,897,1110,1586,2535,2565`).
  - Miniaturas não ganham fonte maior: `PhoneSimulator` e a prévia do banner.
  - A passada mecânica de classe (`#09090b`→`bg-admin-bg`, ouro literal→`admin-gold`, `text-[<11px]`→`text-[11px]`) é recomendada nos arquivos da frente com teto ≤ 50. Nos de teto maior (`AdminBannersView` 326, `AdminProductFormView` 101), só nos blocos que a frente já reescreve.
- **Não renomear:**
  - "Guia de Controle de Pedidos" e "Guia de Ajuda e Explicações" (`AdminOrdersView:2128,1550`);
  - "Guia de Ajuda e Informações" (botão do CRM; `crm-do-painel`, `ajuda-do-dashboard-descreve-os-kpis-da-tela:164`);
  - "Quantidade em Estoque" (citado pelo guia; teste `admin-orders-guia…:409`);
  - "Pagamento online (PIX)" e "Funcionando/Chave ausente/Desligado" (espelhados em `AdminSettingsView:637-641`, onda 4);
  - "Contas e categorias";
  - "Diagnóstico de Conexão" (onda 4).
- **Somente leitura, além da lista antiga:**
  - `tests/front/titulos-pelo-nome-unico-telas.test.ts`, `titulos-pelo-nome-unico-abas.test.ts`, `portas-das-abas-nas-telas.test.tsx` (cruzam frentes);
  - `portao-dividido-classificacao.test.ts`, `paralelo-faixas.test.ts`;
  - `admin-settings-secoes-colapsaveis`, `admin-ajustes-salao-e-porao`, `ajustes-disclosure-do-diagnostico` (onda 4);
  - `src/hooks/useProducts.ts`, `src/lib/erro-do-painel.ts`, `src/lib/whatsapp-do-cliente.ts`, `src/components/admin/PontoDeOperacao.tsx`, `supabase/**`.
- **`mensagemDeErroDoPainel` tem limite.** Ela troca tudo que não é 22023 pela frase genérica. Não a use em texto que já chega em português (P0001 das RPCs, `error_message` da cotação).
- **Nome de arquivo novo sem palavra do mapa de risco** quando a frente é ROTINA (`*frete*`, `*order*` etc. acendem o `revisor-risco` automaticamente).
- **Verificação de cada frente:** os testes listados + `npx vitest run tests/front/painel-sem-jargao.test.ts tests/front/regua-visual-do-painel.test.ts` ("baixe o teto para N" nos seus arquivos é esperado) + `npm run typecheck; echo exit=$?` + `CI=true npm run lint:ratchet` + `node scripts/paralelo/frente.mjs conferir`.

### 1. crm — G1 — ROTINA

**Objetivo.** Relatórios sem jargão. Teto: AjudaDoCrm 7, CanaisDoCrm 2, VisaoGeralDoCrm 2, OperationalPerformanceChart 2, StrategicIntelligenceBlocks 1, NumerosDoMes 1 → todos 0.

**O que trocar:**
- `src/lib/crm.ts:400-460`, rótulos de `infoDoSegmento` (os slugs `campeoes`… NÃO mudam, vêm de `crm_visao`):
  - Campeões → Melhores clientes
  - Leais → Fiéis
  - Quase dormindo → Sumindo (reescrever a descrição, hoje "Sumindo aos poucos")
  - Em risco → Podem não voltar
  - Não pode perder → Bons clientes sumindo
  - Hibernando → Parados há muito tempo
  - Conferir se o texto pronto de WhatsApp por segmento cita o rótulo.
- `AjudaDoCrm.tsx:42-50`: LTV, ticket médio, RFM, segmentos.
- `CanaisDoCrm.tsx:216,452` e `VisaoGeralDoCrm.tsx:121`: "Ticket médio" → "Valor médio por venda".
- `VisaoGeralDoCrm.tsx:171`: "LTV médio" → "Total já comprado por cliente (média)".
- `OperationalPerformanceChart.tsx:215`: "ROI do Estoque" → "Retorno do estoque".
- `OperationalPerformanceChart.tsx:255` e `StrategicIntelligenceBlocks.tsx:396`: "Ticket Médio:" → "Valor médio por venda:".
- `inicio/NumerosDoMes.tsx:62`: "ticket médio" → "valor médio por venda".

**Teste primeiro:** `relatorios-falam-a-lingua-da-loja.test.tsx`.
- (a) `infoDoSegmento` de cada slug não casa nenhum `padroesProibidosDoPainel()`, e os 6 rótulos batem com `termoDoLojista()`.
- (b) `VisaoGeralDoCrm` e `CanaisDoCrm` com dados mockados não mostram "Ticket", "LTV" nem "ROI".
- (c) `NumerosDoMes` mostra "valor médio por venda".

**Atualizar:**
- `crm-do-painel` (360-366, 509-555: "Em risco", "Mostrando: Em risco · 2");
- `crm-visual-clientes` (54-66);
- `crm-contraste-aa` (205-225 "Campeões");
- `crm-e-inicio-funcoes-puras` (638);
- `painel-numeros-do-periodo-nao-mentem` (linha de resumo "Ticket Médio" do bloco Performance).

**Riscos:**
- `crm.ts` alimenta o Início: só strings mudam.
- `grafico-de-categorias-nao-promete-frete` tem "frete" no nome; editá-lo acende o `revisor-risco`. Evite editá-lo.

**Vizinhas:** clientes-e-catalogo e pedidos-e-dinheiro usam as mesmas palavras ("Valor médio por venda", "Total já comprado").

### 2. financeiro — G2 — DINHEIRO (revisor-risco)

**O que trocar:**
- `AdminFinanceiroView.tsx:79`: rótulo "DRE" → "Resultado". O valor `"dre"` da aba fica.
- Selo "Avançado" na aba `contas`; o nome da aba continua "Contas e categorias".
- `AbaDre.tsx`: 395 "Margem de contribuição" → "Sobra depois dos custos da venda"; 422, 442, 471.
- `AbaContasECategorias.tsx:209`.
- `FolhasDeCadastro.tsx`: 338; 376 "Grupo da DRE" → "Linha do resultado".
- `FolhasDeLancamento.tsx:414`.
- `NovoLancamentoFolha.tsx`: 260; 377 rótulo "Competência" → "Mês de referência"; 390 ajuda.
- `src/lib/financeiro.ts`: 581 "Fora da DRE"; 1368 "(=) Margem de contribuição"; 1563; 1567. Opcional: 1358 "(−) CMV" escrito por extenso.
- **Não mudam:** `dataCompetencia`, `data_competencia`, `grupoDre`, `fin_dre`, nenhum cálculo.

**Teste primeiro:** `financeiro-fala-a-lingua-da-loja.test.tsx`.
- Existe a aba "Resultado" e não existe a aba "DRE".
- "Contas e categorias" é a última aba e tem o selo "Avançado".
- O rótulo "Mês de referência" aparece, e o payload do salvar segue com `data_competencia`, igual ao caso de `admin-financeiro-novo-lancamento:225`.
- A linha da DRE na lib traz o texto novo.

**Atualizar:** `financeiro-lib.test.ts` (linhas da DRE, se afirmadas); `admin-financeiro-novo-lancamento` (se procura "Competência" por texto). `financeiro-fluxo-poucos-pontos-de-saldo` (152, 316) continua igual.

**Risco:** só texto em tela de dinheiro. O revisor-risco confere que o diff não toca regra nem chamada `fin_*`.

### 3. pagamentos-e-mp — G4 — DINHEIRO (revisor-risco)

**`StatusPagamentoPix.tsx:40-53`.** Os 3 `DIAGNOSTICO` saem sem `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, Supabase, flag e frota. Cada um diz o que houve e o que fazer:
- ok: "Funcionando: o cliente já paga por PIX dentro do app."
- alerta: "…falta a chave pública da loja: a tela de pagamento não abre para o cliente. Salve as chaves de novo em Pagamentos › Mercado Pago; se continuar, fale com o suporte técnico."
- off: "O cliente paga na entrega. Para receber por PIX no app, cadastre as chaves em Pagamentos › Mercado Pago."
- `text-[10px]` (114, 150) → ≥ 11px. Os rótulos de nível ficam.

**`MercadoPagoSection.tsx`:**
- `TEXTO_DA_FALTA` (159-161): "colar a chave pública", "colar a chave secreta", "colar a senha dos avisos".
- Toasts 406 e 411.
- 729: "Chave secreta {mascara}".
- 806, 826, 855 (rótulos dos campos): "Chave pública (Public Key)", "Chave secreta (Access Token)", "Senha dos avisos (Chave de notificações) — obrigatória para receber pelo app". O parêntese faz a ponte com as mensagens da edge, que não mudam (ex.: "o Access Token está errado…").
- Placeholders 842 e 872; texto 1147.

**`mercado-pago-conteudo.ts`:**
- Passo 5 (84) e `RECADO_DE_SEGURANCA` (203) nas palavras da loja.
- `montarPromptParaAgenteMp` (157-190) **mantém** "Public Key / Access Token / Webhooks / Assinatura secreta". É texto para o agente do MP, e na onda 4 ele fica dentro de Avançado.

**Trava:** nenhuma linha com `invoke("credenciais-mercado-pago"`, `action:` ou corpo muda. O revisor confere por diff.

**Teste primeiro:** `mercado-pago-fala-a-lingua-da-loja.test.tsx`.
- Os 3 diagnósticos sem os termos proibidos.
- `ler` mockado com faltando=[public_key, access_token, chave_notificacoes] mostra as 3 frases novas.
- O prompt continua com "PUBLIC KEY", "ACCESS TOKEN" e "Assinatura secreta".

**Atualizar:**
- `status-pagamento-pix-termometro`;
- `admin-mercado-pago-liberacao-automatica` (356, 581 "colar a Chave de notificações"; 551 rótulo do campo; 359-360 seguem valendo);
- `mercado-pago-guia-copia-prompt` (205);
- `mercado-pago-secao-salva-e-testa` (S1, se procura a máscara pelo texto "Access Token").
- **Não mudam:** asserções de mensagem da edge (236, 200, 449, 474).

**Resíduo esperado na guarda:**
- MercadoPagoSection ≈ 7: 4 identificadores (2, 25, 616×2) + 3 rótulos com parêntese.
- mercado-pago-conteudo ≈ 15: prompt + nome da função. Listar linha a linha.

**Vizinha:** onda 4 (H6 mexe de novo nestes arquivos). Não tocar `FormasDePagamentoCard`.

### 4. frete-cards — G5+G6 — ROTINA

**G5 (`HistoricoCotacoesCard.tsx`):**
- "Destino" (194) → "CEP do cliente".
- Provedor (223): usar `NOME_DO_PROVEDOR` em vez de `replace` + `capitalize`.
- "Contingência" (243): trocar por frase da loja, conferindo na edge o que grava `status='contingency'`.
- Cabeçalho `text-[10px]` (192) → ≥ 11px.
- Motivo: nova função pura `src/lib/motivo-da-cotacao.ts` → `motivoDaCotacao(texto)`.
  - Frase em português passa igual.
  - `…API retornou N: {…}`, JSON ou HTML cru viram "A transportadora não respondeu direito (erro N). Tente de novo mais tarde."
  - O texto inteiro continua no `title`, e o corte de 200 continua.
  - **Não** usar `mensagemDeErroDoPainel`: apagaria o motivo acionável que a edge grava.

**G6 (`TransportadorasCard.tsx`):**
- Resultado do teste (1535-1537): nome primeiro (`nomeDoServico ?? \`Serviço ${s.codigo}\``) e o código no `title`. Sem tabela fixa de nomes: o nome vem de `list_services`.
- **Fonte oficial consultada:** SDK oficial do Melhor Envio, `melhorenvio/shipment-sdk-php`, `src/Enums/Service.php`.
  - 12 = `LATAMCARGO_JUNTOS`, 15 = `AZULCARGO_AMANHA`, 16 = `AZULCARGO_ECOMMERCE`.
  - **22 não está no enum.** O comentário da edge diz Buslog: NÃO confirmado.
  - `docs.melhorenvio.com.br` e a API pública estão bloqueados pelo proxy daqui; o context7 falhou.
- "Modo de testes (Sandbox)" (1360) e aria-label (1372) → "Modo de teste". O teste acha o interruptor por "SuperFrete" e continua achando.
- Identificadores internos `onSandboxMudou` e `emSandbox` (1135, 1162-1163, 1190, 1277, 1298, 1373) podem ser renomeados (não são exportados) → teto 0.
- `GuiaDaChaveDoProvedor.tsx:83`: sem "Sandbox".
- A mensagem da edge "Para trocar o modo de testes (Sandbox)…" não muda.

**Teste primeiro:**
- `motivo-da-cotacao.test.ts` (puro);
- `historico-de-consultas-legivel.test.tsx` ("CEP do cliente"; "SuperFrete"; motivo cru vira frase e o `title` traz o texto inteiro);
- `transportadoras-servico-pelo-nome.test.tsx` ("PAC: cotou certo"; sem a lista carregada, "Serviço 1: cotou certo").

**Atualizar:**
- `admin-shipping-historico-honesto` (254, classe `text-[10px]`; "Destino");
- `admin-shipping-historico-mostra-o-motivo`;
- `transportadoras-teste-de-credenciais` (161 "1: cotou certo");
- `transportadoras-por-provedor-e-ligados` (rótulo; o 890 fica);
- `transportadoras-servicos-e-seguro` (293, aviso do id 12, fica).

**Riscos:** os exports da linha 53 em diante e as props `onDirtyMudou` / `onLigadosMudou` de `TransportadorasSection` não mudam (a onda 4 depende delas). Nenhuma chamada a `calculate-shipping` muda.

### 5. devolucao-e-identidade — G8+G9 — DEVOLUÇÃO (revisor-risco)

**G8 (`PoliticaDeDevolucaoSection.tsx:88,105`):**
- Arrependimento: "Mínimo de 7 dias: é o direito de arrependimento que a lei garante em compras fora da loja física."
- Defeito: "Mínimo de 30 dias: é o prazo da lei para reclamar de defeito em produto não durável (o durável tem 90)."
- O payload de `salvar_politica_de_devolucao` e os mínimos 7/30 não mudam.

**G9 (`IdentitySettingsSection.tsx`):**
- O `<details>` (241-254) vira `SecaoRecolhivel titulo="Ícones do app (avançado)"`, com o mesmo conteúdo e ordem (5 ícones + arte + "Fontes guardadas").
- Rótulos de `advanced` (41-48):
  - Favicon → Ícone da aba do navegador
  - Ícone Apple → Ícone do iPhone
  - 192 → Ícone pequeno (192 × 192)
  - 512 → Ícone grande (512 × 512)
  - máscara → Ícone do Android (recortado)
- Os roles (`favicon`, `apple_touch`…) não mudam.
- **Não tocar:** `fields`, `camposEscondidos`, `camposDoConflito`, `uploadControl`, `useStoreIdentityEditor`, `src/lib/adminStoreIdentity.ts`. Precisou mexer em algum deles: PARE e escale.

**Teste primeiro:**
- `devolucao-prazos-em-palavras.test.tsx`: sem "CDC"; o payload do salvar é idêntico ao do caso 153-170 de `devolucao-politica-no-painel`.
- `icones-do-app-no-avancado.test.tsx`: a seção nasce fechada e os 5 inputs estão no DOM, ocultos; nenhum "Favicon" nem "Ícone Apple"; salvar a marca com a seção fechada manda o mesmo `desired_identity` de 8 chaves.

**Atualizar:** `devolucao-politica-no-painel` (126, 129, 142, 146); `admin-settings-identidade-da-loja` (316); `identity-settings-section` (279 "Trocar Ícone 192").

**Fora:** o lado da cliente (a folha de devolução cita "art. 49").

### 6. produto — G3+H1 — ROTINA (o revisor confere: nada desmonta, payload igual)

**Estado de hoje** (`AdminProductFormView`, 4624 linhas):
- Ordem: Fotos (~2899) → Variações (~3301) → Informações básicas (~3489: Nome, Descrição*, Categoria*, SKU ~3693, Código de barras ~3726, Estoque* ~3783, Peso e dimensões ~3817) → Precificação (~3919: Custo ~4044, Venda ~4080, "De:" ~4142).
- Modal de variação inline em ~2440-2780.

**G3 (teto 30 → 2):**
- "Código interno (SKU)" só nos 2 rótulos de campo (3693 e 2453): ponte com as mensagens do `useProducts`.
- O resto vira "código interno": 955, 1514, 1517, 2470, 3563-3574, 3707, 4379-4449.
- EAN/UPC/GTIN (2544, 3574, 3745) → "Código de barras".
- 2478 → "Aparece na loja?"
- 2608 → "Preço diferente nesta variação"
- 2759 → "Salvar"
- 2760 → "Salvar variação"
- `LinhasDaGrade.tsx:110,119,172`: "Código interno base", "sem código".
- `ModalVarianteGrade.tsx:348-350` (toast) e "Efetivar N variantes" → "Salvar N variações".
- `PhoneSimulator.tsx:712`: "Avaliações (15)".

**H1a — layout:**
- Abertos: Fotos e Básico (Nome, Descrição — é obrigatória —, Preço de venda — sobe da Precificação, só JSX —, Estoque, Categoria).
- `SecaoRecolhivel` montadas e fechadas: "Custo, lucro e preço 'de'", "Peso e medidas (para o frete)", "Variações", "Avançado" (código interno, código de barras).
- Nenhum `useState` se move. Nada de `{aberta && …}`.

**H1b — erro abre e foca:**
- `temErro` = OR dos erros da seção. Os estados de erro estão em 479-507.
- No submit com erro, focar o primeiro campo com erro depois do commit (`requestAnimationFrame`).
- O teste prova com custo negativo ou código interno inválido (não existe erro de peso).

**H1c — produto com variações abre "Variações":**
- `abertaInicial` só vale na montagem, e o corpo monta antes do `formData` chegar.
- Usar uma `key` que muda uma vez quando o produto carrega.
- Não editar primitivos. Se a `key` não servir, vira PEDIDO ao integrador: modo controlado no `SecaoRecolhivel`.

**Teste primeiro:**
- `produto-fala-a-lingua-da-loja.test.tsx`;
- `produto-basico-primeiro.test.tsx` (a, b, c + "digitar o peso com a seção fechada e reabrir mantém o valor").

**Atualizar:**
- `admin-product-form-variacao-sku-e-publicar-diz-o-que-falta` (191);
- `admin-product-form-desligar-ultima-variacao-zera-estoque` (198-240);
- `admin-product-form-grade-criar` (260, 294, 481, 563, 567, 571, 602, 606, 683);
- `admin-product-form-guia-diz-a-regra-real-do-estoque` (168-185);
- `admin-product-form-codigo-de-barras`;
- todo teste que procura com `getByRole` um campo que passa a ficar em seção fechada (`hidden` sai da árvore de acessibilidade).

**Fora:** H2 (estoque mínimo) fica para a Onda I.

### 7. push-e-banners — H3+H4 — ROTINA

**H3 (`AdminPushView.tsx`):**
- Extrair `updateUrl` (391-411) para `src/lib/destino-do-aviso.ts`: `urlDoDestino(tipo, idDoProduto, caminho)` e o inverso `destinoDaUrl(url)` (o efeito 428-455). Valores idênticos aos de hoje.
- Tirar "Outra Página (Link manual)" da lista (1447-1449). O campo manual (1490-1510) vai para dentro de `SecaoRecolhivel "Avançado: abrir outra página"`, que abre sozinha se a URL de um modelo não for reconhecida.
- Filtro por nome no seletor de produto.
- Placeholder sem "/exemplo-pagina".
- Sem destinos novos (ver P3).

**H4 (`AdminBannersView.tsx`):**
- Preferência lembrada **no aparelho**: `localStorage` chave `"admin_banner_modo"` (mesmo prefixo de `admin_banner_form_draft`, linha 1326), via `src/lib/modo-do-editor-de-banner.ts` (`lerModoDoEditor` / `gravarModoDoEditor`).
- Leitura e gravação com try/catch. Valor desconhecido → "simple".
- Grava só quando o lojista toca no alternador (2300, 2323).
- Vale para banner novo (1443) e para editar banner sem texto. **Banner com texto abre sempre em Completo** (1399-1404), senão salvar apaga o texto.

**Teste primeiro:**
- `destino-do-aviso.test.ts`: tabela dos 8 tipos com as URLs literais de hoje; ida e volta; `/product/123` antigo.
- `push-destino-escolhido.test.tsx`: a lista não tem "Outra Página"; `#push-custom-path` só dentro de Avançado; produto filtrado por "tênis" envia `/product-detail?id=…`.
- `banners-modo-lembrado.test.tsx`: primeira abertura Simples; Completo lembrado após remontar; banner com título abre Completo mesmo com "simple" lembrado; `localStorage` que lança não quebra.

**Atualizar:** `admin-visual-canais-avisar` (385 continua valendo); push e banners só se clicarem "Outra Página".

**Régua:** só nos blocos tocados; não trocar cor de dado.

### 8. pedidos-e-dinheiro — resto do jargão — DINHEIRO (revisor-risco)

**O que trocar:**
- "Estorno devido" → "Devolver ao cliente" em `AlertasCancelados.tsx:319,344,409` e nas citações do guia (`GuiaDoPagamentoQueNaoFechou.tsx:155,176,200,247`).
- "(chargeback)" (guia 171; `EstornoCard.tsx:74,80`) → "Contestação no cartão…".
- `OrderDetail.tsx:270,277`: "Carregando código…" e "Código: X".
- `AdminOrdersView.tsx:561`: "Ticket Médio" → "Valor médio por venda" (a F3 depois tira o cartão).
- `CupomDaVenda.tsx:488`: "por nome ou código interno".
- **Mesmo commit:** AlertasCancelados + Guia + as citações do teste do guia.
- **Não tocar:** `AdminOrdersView:959` (contrato 22023) nem os rótulos citados que não estão no glossário.

**Teste primeiro:** `pedidos-falam-a-lingua-da-loja.test.tsx` (EstornoCard, AlertasCancelados, OrderDetail).

**Atualizar:** `admin-orders-guia-do-pagamento-que-nao-fechou` (251, 258, 276, 287, 329, 368, 420); `estorno-card-lojista-devolve-o-dinheiro` (377).

**Risco:** só texto. Nenhum handler, RPC ou `valor-devolver-agora` muda.

### 9. clientes-e-catalogo — resto do jargão — ROTINA

**O que trocar:**
- `AdminCustomersView.tsx`: 61, 276, 658 ("Contato / Tipo de conta"), 675, 776, 923, 1131 ("Total já comprado").
- `AdminUserDetailView.tsx`:
  - 778, 823, 1351, 492, 504, 772;
  - 669: o botão WhatsApp passa a usar `linkWhatsappDoCliente(profile.whatsapp)`. Com menos de 10 dígitos o botão fica desabilitado; hoje abre um link quebrado.
- `AdminProductsView.tsx`:
  - 346, 969, 1736 → "Dinheiro parado em estoque";
  - 357, 993, 1028 → "Lucro se vender tudo";
  - 375, 1105 → "Margem %".
- `AdminQAView.tsx`: remover o cartão "Conversão Comercial" (472-494); 1051, 1179, 1369, 1374 sem "Q&A" nem "SAC".

**Teste primeiro:** `listas-falam-a-lingua-da-loja.test.tsx`.
- `wa.me/5511988887777` para `(11) 98888-7777`; com 4 dígitos, desabilitado.
- 3 cartões de KPI em Perguntas.
- "Total já comprado" ordena desc no primeiro clique.

**Atualizar:**
- `admin-customers-ordenacao-ltv-e-ajuda-honesta` (214-272);
- `admin-customers-ticket-medio`;
- `admin-user-detail-pedidos-que-contam` (304, 329, 344);
- `admin-ficha-cliente-resumo`;
- `admin-products-margem-sem-custo` (315);
- `admin-qa-view-erro-nao-e-fila-limpa` (227 conta 3 travessões; continua 3).

### Pedidos ao integrador (onda 3)

1. `integrar` as 9 frentes na ordem do manifesto.
2. `ATUALIZAR_TETOS=1` nos dois testes de guarda.
3. Rodar os testes sem dono que montam seções tocadas: `admin-settings-secoes-colapsaveis`, `admin-ajustes-salao-e-porao`, `titulos-pelo-nome-unico-*`, `portas-das-abas-nas-telas`, `admin-visual-telas-titulo-padronizado`, `rotas-de-entrada` (43/24), `hospedagem-rotas` (67/134). Se quebrar, ajustar só rótulo.
4. Ajustar `.lint-baseline.json` se o ratchet mostrar que algum número caiu.
5. `npm run build && npm run size`. As 3 libs novas são importadas só pelo painel.

## 3. ONDA 4 — esboço (depois da integração da 3)

São 2 frentes, disjuntas entre si. O rascunho do manifesto foi validado (`ondas-gh-4.json`, "2 frentes disjuntas"). G7, H5 e H6 tocam `AdminSettingsView`, então ficam todos numa frente só, em série.

### Frente A `ajustes-frete-e-pagamentos` — DINHEIRO (revisor-risco)

**Posse:** `AdminSettingsView.tsx`, `AdminShippingView.tsx`, `shipping/FreteNacionalBloco.tsx`, `settings/grupos-de-ajustes.ts`, `HistoricoCotacoesCard.tsx`, `TransportadorasCard.tsx` (só comentários), `MercadoPagoSection.tsx`, `FormasDePagamentoCard.tsx`, `StatusPagamentoPix.tsx` e 29 testes (AdminSettingsView 16 e AdminShippingView 12 tocam essas telas). Ordem interna: A1 → A2 → A3 → A4 → A5.

**A1 · H5 — o Frete monta Transportadoras.**
- Novo `PainelRecolhivel` "Transportadoras" entre "Fora da cidade" e "Estratégias do frete local".
- `TransportadorasSection` **monta na primeira abertura e não desmonta mais**:
  - montar já no mount dispararia uma segunda leitura `ler_configuracao_frete` e quebraria as contagens de invoke dos testes da tela;
  - desmontar ao fechar perderia o token digitado.
- `onDirtyMudou` entra no dirty da tela.
- `onLigadosMudou` atualiza `ligadosSalvos` / `provedoresSalvos` (`AdminShippingView:213-230`), para a faixa e o "Fora da cidade" refletirem o que acabou de ser salvo.
- `FreteNacionalBloco`: `onAbrirAjustes` → `onAbrirTransportadoras` (227, 219, 238, 295, 304); `AdminShippingView`: 738 e a ajuda 884-891.
- Sem lazy: mesmo módulo, já importado de forma estática.

**A2 · H5 — Consultas de frete no Frete.** Painel "Consultas de frete" junto de "Etiquetas", sob o título "Avançado". `HistoricoCotacoesSection` renderizada **só com o painel aberto**: busca fresca a cada abertura, como hoje.

**A3 · H5 — Ajustes fica só com a porta. Resposta ao `nomesLigados` / `provedoresDeFrete`:**
- Saem: o `SecaoColapsavel "Transportadoras"` (910-920), `transportadorasPendentes` (654, 684), `onLigadosDaSecaoMudou` (772-781), `nomeDoFrete` (782-795, usado só nos dois "Ativo: …") e "Consultas de frete" (1074-1080).
- **Ficam:** `buscarConfiguracaoDeFrete` → `provedoresDeFrete` → `nomesLigadosDeFrete` → `subtitulosDosGrupos({nomesLigados})`, a regra E5 do subtítulo de "Entrega e frete".
- Ajustes é aba mantida montada (`AdminArea`, `DeferredTabContent active=…`), e o callback que refrescava a leitura vai embora. Então a leitura passa a rodar **cada vez que `active` vira true** (`useEffect` com `[active]`). Sem isso, salvar a transportadora no Frete e voltar a Ajustes mostra subtítulo velho.
- `grupos-de-ajustes.ts`: só textos (ajuda de "entrega" linha 74; de "ferramentas" linha 100, que cita "Consultas de frete" e "medição de latência"; documentação de `nomesLigados` 134-140; comentário 19-23). `subtitulosDosGrupos` e os tipos não mudam.
- **Teste:** `frete-um-lugar-so.test.tsx`.
  - O Frete tem o mesmo formulário de chave.
  - Uma só leitura antes de abrir.
  - Token mantido ao fechar e reabrir.
  - Ajustes não monta `TransportadorasSection` nem `HistoricoCotacoesSection`.
  - `painelInicial="nacional"` ainda abre "Fora da cidade".
  - Ajustes inativo → ativo relê.
- **Atualizar:** `admin-ajustes-salao-e-porao`, `admin-settings-secoes-colapsaveis` (287-288, 439-440), `ajustes-grupos-e-portas`, `admin-frete-nacional-botao-abre-tela`, `admin-shipping-frete-unificado`, `admin-shipping-national-view`, `admin-visual-frete`, `admin-shipping-frete-por-provedor`, `admin-frete-v2-contrato`.

**A4 · G7 — diagnóstico de Ajustes.** `ConnectionDiagnosticsSection` (81-340): 179-180 ("latência (ping)… perda de pacotes… Supabase") e 188 ("Latência Média") passam a falar em conexão boa / lenta / sem internet; os ms ficam num detalhe. Teto 3 → 0. "Diagnóstico de Conexão" é afirmado em `ajustes-disclosure-do-diagnostico:95-121`. **Teste:** `diagnostico-de-conexao-em-palavras.test.tsx`.

**A5 · H6 — os lugares do status do PIX hoje:**
1. Subtítulo do grupo Pagamentos: `grupos-de-ajustes.ts:174-185`, alimentado por `nivelDoPix` (`AdminSettingsView:729-733`).
2. "Formas de pagamento": subtítulo `… + app` (948) e a linha "Pagar pelo app (PIX) Ligado/Desligado" em `FormasDePagamentoCard.tsx:164-174,223-230`.
3. Ferramentas › "Minha loja está no ar?": subtítulo `PIX: ${rotuloDoPix}` (1061, `ROTULO_DO_PIX` 637-641) e `<StatusPagamentoPix>` (1065).
4. `MercadoPagoSection`, bloco "Receber PIX no app" (~926-1120): é o estado do servidor, com Pausar/Retomar, que ecoa para 1-3 por `onPixAlternado`.

O atalho do Início (`AdminDashboardView:66`) é pendência e é permitido.

**Recomendação (P2):**
- Fica um status só: o termômetro no topo de Pagamentos. O subtítulo do grupo continua (é o resumo "como você recebe").
- "Formas de pagamento" perde o "+ app"; a linha do `FormasDePagamentoCard` vira link sem estado.
- "Minha loja está no ar?" mostra só a conexão e um link para Pagamentos (o `abrirMercadoPagoGatilho` já existe).
- O bloco do Mercado Pago fica com Pausar/Retomar e a lista do que falta, sem repetir "Pix liberado".
- "Como pegar suas chaves" (740) e "Suas chaves" (794) entram em `SecaoRecolhivel "Avançado: chaves do Mercado Pago"`, montado. Com pendência, abre.
- O import e o uso de `pixConfiguradoNoBuild` (727) ficam: é o contrato de `pix-configurado-no-build-contrato`.
- Nenhuma chamada a `credenciais-mercado-pago` muda.
- `FormasDePagamentoCard:317` (`err.message`): conferir o que `salvarConfigDoCartao` lança antes de mexer.
- **Teste:** `pagamentos-status-uma-vez.test.tsx`.
- **Atualizar:** `admin-ajustes-salao-e-porao` (486-510, 736), `admin-settings-pix-acompanha-o-interruptor` (254-349), `admin-settings-secoes-colapsaveis` (247-274), `formas-de-pagamento-*`, `status-pagamento-pix-termometro`, `admin-mercado-pago-liberacao-automatica`, `mercado-pago-*`.
- **No fim:** `npm run build && npm run size`.

### Frente B `selo-e-erro-cru` — ROTINA

**Posse:** `layouts/AdminLayout.tsx`, `admin/PontoDeOperacao.tsx` e 5 testes.

**B1 · G7 — selo e ponto de operação:**
- `AdminLayout:766-828`: `text-[7px]` (812) → ≥ 11px. AdminLayout está fora das pastas da régua, mas a regra vale.
- `title` "Latência: Nms" (778) → "Conexão boa" / "Conexão lenta".
- Rótulos: "Sem internet", "Lenta", "Online", "Sincronizado".
- "Navegação Unificada" (826) sai.
- `PontoDeOperacao.tsx:61-84`: "Tempo real ativo — latência Nms" → palavras.
- **Testes:** `selo-de-conexao-em-palavras.test.tsx` (novo), `ponto-de-operacao.test.tsx`.

**B2 · G10 vira guarda.**
- Não há toast cru a trocar no painel.
- `useOrders.ts:3332,3407` (`description: err?.message`) mostra frases em português que a RPC levanta com P0001; `mensagemDeErroDoPainel` as esconderia. **Não trocar.**
- Entrega: `tests/front/painel-sem-erro-cru.test.ts`, uma varredura de fonte que proíbe `toast.error(<x>.message)` em `src/views/admin` e `src/components/admin`, com allowlist motivada só para `AdminOrdersView:959` (22023).
- Tratar "Failed to fetch" nos hooks é outra tarefa (DINHEIRO, `useOrders`).

## 4. Perguntas ao dono

- **P1 — Palavras do Financeiro.** "DRE" → **"Resultado"**, e não "Resultado do mês": a aba segue o período escolhido e tem modo mês a mês. "Competência" → **"Mês de referência"**, e não "Mês da venda": o campo vale para despesa lançada à mão. "Resultado do mês" e "Mês da venda" mentiriam nesses casos. Recomendo assim. Sem resposta, segue a recomendação; reverter são 2 strings.
- **P2 — PIX: um status só.** O termômetro no topo de Pagamentos fica como o único status; o bloco do Mercado Pago fica com Pausar/Retomar sem repetir o estado. Melhora: o mesmo dinheiro não aparece em 4 lugares. Custo: quem procurava em Ferramentas passa a achar um link. Sem resposta, segue.
- **P3 — Destinos novos no aviso** ("uma categoria", "Cupons"). São capacidade nova: URLs que a lista não tem hoje. Recomendo não agora; a H3 fica só com reorganizar e mandar o manual para Avançado.
- **P4 (não bloqueia) — Nome de reserva para serviço do Melhor Envio.** Só se você quiser um nome de reserva quando a lista não carrega. O id 22 não está no SDK oficial; o código diz Buslog. Recomendo sem tabela fixa: o nome vem da API.
- **P5 — Onda F não foi feita.** Ela toca os mesmos arquivos de crm, clientes-e-catalogo e pedidos-e-dinheiro. Recomendo rodar F depois de H, e não embutir.

## 5. Suposições

- A base é 509ca588 e os nomes de plano são `painel-simples-ondas-gh-3` / `-gh-4`.
- O integrador regrava os dois tetos.
- Termo técnico entre parênteses é aceito onde faz ponte com texto de edge, hook ou da tela do MP, e o resíduo é listado. A spec diz "entre parênteses ou em Avançado".
- Cor que é dado do banner e as miniaturas (`PhoneSimulator`, prévia do banner) ficam fora da meta 0 da régua; a guarda não sabe distinguir.
- O modo do banner é preferência do aparelho (`localStorage`), não da conta.
- Nenhuma migration, RPC, edge function ou service worker entra nas ondas 3 e 4.

Fontes:
- [melhorenvio/shipment-sdk-php — src/Enums/Service.php (SDK oficial)](https://raw.githubusercontent.com/melhorenvio/shipment-sdk-php/master/src/Enums/Service.php)
- [melhorenvio/shipment-sdk-php — README](https://github.com/melhorenvio/shipment-sdk-php)
- [Blog Melhor Envio — Azul Cargo](https://melhorenvio.com.br/blog/frete-e-logistica/azul-cargo-rastreio/)
- [Blog Melhor Envio — LATAM Cargo](https://melhorenvio.com.br/blog/frete-e-logistica/latam-cargo-rastreio/)
