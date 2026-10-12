
# Painel simples — design

> 09/10/2026. Pedido do dono (literal, resumido): melhorar o painel inteiro **mantendo como está**, mas simplificando: lojista leigo, minimalismo, visual limpo, sem informação repetida, tudo organizado, sem precisar "estudar" a plataforma. Exemplo dele: o endereço da loja é pedido em vários lugares.
> **Interpretação:** não é reescrever. É reorganizar, tirar repetição, falar a língua do lojista e padronizar o visual **sem tirar nenhuma capacidade**.
> **Escopo:** dentro. Quem sente a falta hoje é o lojista operando o painel da própria loja (o Gabriel). Nada aqui toca cobrança, clone ou assinatura. O cartão de assinatura do Início continua só de leitura.

## 1. Problema (medido no código)

- **Portas:** 18 telas só se abrem por cartões internos espalhados. Frete fica em *Produtos*. Perguntas e Avaliações ficam em *Pedidos*. "Avisar clientes" só tem porta na barra lateral do computador e no cartão de Clientes.
- **Nomes:** a mesma tela tem 2 a 4 nomes. Exemplo: Perguntas aparece como "Suporte", "Perguntas", "Suporte Q&A" e "Guia de Dúvidas (Q&A)".
- **Voltar:** o "Voltar" do navegador e o do painel discordam para push, banners e whatsapp-config, porque `App.tsx:1765-1880` e `pai-da-tela-do-admin.ts` têm regras diferentes.
- **"Onde fica a loja" tem 5 fontes que ninguém cruza:**
  1. `store_address`, texto livre em Sobre a Loja;
  2. `origin_cep`, só em Frete › Fora da cidade;
  3. `store_city`/`store_state`, em Sobre a Loja › Marca;
  4. `politica_devolucao.endereco_devolucao`;
  5. o endereço da conta Melhor Envio, digitado fora do app, que é o remetente da etiqueta.

  A cotação usa o CEP, a etiqueta usa a conta ME e o rótulo "Entrega em {cidade}" usa a cidade digitada em outra tela.
- **Horário:** duas telas gravam a mesma coluna `business_hours`. Salvar o WhatsApp em Atendimento regrava o horário com o que estiver no formulário daquela tela, e isso pode apagar o que foi salvo em Sobre a Loja.
- **Números:** o mesmo rótulo vem de fontes diferentes. "Receita Hoje" em Pedidos conta por `created_at`; no Início conta por data do pagamento. O selo de Pedidos conta PIX não pago; o "Para preparar" do Início não. "Estoque baixo" usa 3 no Início e 5 no resto.
- **Linguagem:** jargão exposto, como "Public Key", "Access Token", "Webhooks", "MP_ACCESS_TOKEN… segredos do Supabase… frota", "RFM", "LTV", "DRE", "SKU", "EAN/GTIN", "CDC art. 49", "latência/ping" e "/exemplo-pagina".
- **Visual:**
  - ~1000 fontes arbitrárias, cerca de 800 delas entre 6 e 9px;
  - 3 tons de ouro e `#09090b` literal 60×;
  - ~12 raios diferentes;
  - modais feitos à mão sem `role="dialog"`;
  - alvos de toque menores que 44px (~140×);
  - as 5 abas da barra inferior sem nome acessível abaixo de 640px.
- **Primeiros passos:** a lista "Sua loja está pronta para vender?" tem 3 itens e marca "Configurar PIX" como pendente numa loja que só recebe na entrega.

## 2. Princípios

1. **Um lugar para cada coisa.** Cada função tem uma única porta de navegação. Atalhos de pendência ("Para fazer", sino, lista de primeiros passos) são permitidos, porque levam a uma tarefa e não abrem uma segunda casa.
2. **Um nome para cada tela,** o mesmo no menu, no título, no carregando, no Voltar e na ajuda. A fonte é `src/config/nomes-do-painel.ts`.
3. **Um dado é digitado uma vez.** As outras telas mostram o dado só para leitura, com "Alterar em Minha loja".
4. **Um número, um conceito.** Mesmo rótulo exige mesma fonte e mesma janela. Se a fonte for outra, o rótulo é outro.
5. **O básico primeiro, o avançado recolhido.** Nada se apaga: o que é raro vai para "Avançado".
6. **Palavra do lojista.** O termo técnico só aparece entre parênteses ou em "Avançado". Erro diz o que houve e o que fazer.
7. **Regras visuais do dono que já valem** (spec 2026-09-26 §7): celular primeiro, coluna única, KPIs 2×2, cartões em lista, `tabular-nums`, cor nunca é a única pista, toque ≥ 44px. Formulário do admin usa `useState` + `LocalBufferedInput`. A view renderiza só o conteúdo.

## 3. Arquitetura de informação

**Menu:** continua igual (decisão da casa, "mantendo como está"). São 5 abas (Início · Pedidos · Produtos · Clientes · Ajustes), o botão redondo **Vender** e o sino **Notificações**. A barra lateral do computador perde "Avisar clientes", que passa a ter porta única em Clientes. As **rotas não mudam de nome**: só mudam rótulos e portas. Assim `admin-orders` continua igual nas 9 URLs de push das edge functions, e as contagens dos testes de rota ficam iguais.

| Rota | Nome único | Porta única (aba › cartão) | Pai do Voltar |
|---|---|---|---|
| admin-dashboard / admin | Início | aba | — |
| admin-pdv | Vender | botão redondo | admin-dashboard |
| admin-crm | Relatórios | Início › Relatórios | admin-dashboard |
| admin-financeiro | Financeiro | Início › Financeiro | admin-dashboard |
| admin-orders | Pedidos | aba | — |
| admin-devolucoes | Devoluções | Pedidos › Devoluções | admin-orders |
| admin-products | Produtos | aba | — |
| admin-product-form | Produto | lista de Produtos | admin-products |
| admin-coupons / admin-coupon-form | Cupons / Cupom | Produtos › Cupons | admin-products / admin-coupons |
| admin-customers | Clientes | aba | — |
| admin-user-detail | Ficha do cliente | lista de Clientes | admin-customers |
| admin-qa / admin-reviews | Perguntas / Avaliações | Clientes › **Perguntas e avaliações** (uma porta; alternador no topo das duas telas) | admin-customers |
| admin-push | Avisar clientes | Clientes › Avisar clientes | origem, senão admin-customers |
| admin-settings | Ajustes | aba | — |
| admin-about-store | **Minha loja** | Ajustes › Minha loja | admin-settings |
| admin-whatsapp-config | Minha loja (apelido: abre na seção Contato) | — (só link antigo) | origem, senão admin-settings |
| admin-banners / admin-carousels | Banners / Vitrines | Ajustes › Aparência do app | admin-settings |
| admin-shipping / admin-shipping-national | Entrega e frete | Ajustes › Entrega e frete | admin-settings / admin-shipping |
| admin-notifications | Notificações | sino | origem, senão admin-dashboard |

**Ajustes vira o lugar da loja**, em grupos fixos:
- **Minha loja** (dados, contato, endereço, horário);
- **Aparência do app** (Banners, Vitrines);
- **Entrega e frete** (uma porta para a tela de Frete, que na Onda H recebe também as transportadoras e as consultas de frete);
- **Pagamentos** (como hoje);
- **Regras de troca e devolução**;
- **Ferramentas** ("Minha loja está no ar?").

**O que deixa de existir** (só portas e nomes; nenhuma tela, rota ou dado):
- a porta de Frete em Produtos;
- as portas de Avaliações e Perguntas em Pedidos;
- a porta "Canais de Atendimento" em Clientes;
- "Avisar clientes" na barra lateral;
- a tela Atendimento como tela própria (o conteúdo vai inteiro para Minha loja; a rota vira apelido);
- os nomes duplicados.

O "Voltar" do navegador (o reroute no `App.tsx`) passa a perguntar a `paiDaTelaDoAdmin`, que é a regra única.

## 4. Minha loja — fonte única de identidade, contato, endereço e horário

**4.1 O que mora lá** (tela `admin-about-store`, blocos nesta ordem):
1. Marca: nome, logo, cores, ícones avançados recolhidos.
2. Contato: WhatsApp e mensagem de compartilhar, vindos de Atendimento.
3. Endereço da loja.
4. Horário: um editor só, o `BusinessHoursSection`.
5. Sobre a loja: descrição.

No topo, "Falta preencher: …", calculado pela mesma função da lista de primeiros passos (§8).

**4.2 Quem passa a ler em vez de pedir de novo:**
- **Frete:** mostra "Entregas saem de: CEP 01310-100 · Av. Paulista, 1578 — Alterar em Minha loja" e para de gravar `originCep`.
- **Retirada na loja:** sem endereço, a chave explica e leva a Minha loja.
- **Regras de devolução:** "Mesmo endereço da loja" vem marcado quando `endereco_devolucao` está vazio. É a semântica que já existe (vazio = usa `store_address`); só ficou visível.
- **Primeiros passos e o status em Ajustes:** leem da mesma função.
- **Recibo:** continua imprimindo só o nome. Endereço no recibo fica fora deste plano.

**4.3 Modelo de dados — conta feita:**

*Opção A, sem migration (recomendada).* O formulário pede o CEP; `useBuscaCep` (o mesmo da cliente, com CSP já liberado) preenche rua, bairro, cidade e UF. O lojista digita número e complemento. O botão Salvar faz **uma** chamada `updateConfig`, que vira **um** `INSERT … ON CONFLICT` atômico na RPC, com quatro colunas que já existem:
- `origin_cep`;
- `store_address`, um texto montado em formato fixo: `"Rua, nº, compl. — Bairro, Cidade/UF — CEP 00000-000"`;
- `store_city`;
- `store_state`.

Para editar de novo, o formulário lê esse formato de volta (função pura e testada). Endereço antigo em texto livre que não se deixa ler aparece como está, com o aviso "confirme pelo CEP". Nenhum consumidor muda: a cotação, a retirada pela `calculate-shipping`, a página pública, o mapa e o "Entrega em {cidade}" da cliente continuam lendo as mesmas colunas.

- Custo: ~8 tarefas de ROTINA, zero migration, nenhuma ordem de publicação.
- Limite: rua e número não ficam em colunas separadas.

*Opção B, com migration.* São 4 colunas novas (`store_street`, `store_number`, `store_district`, `store_complement`; o CEP continua sendo o `origin_cep`), e com elas:
- reescrever o corpo de `upsert_store_config` (SECURITY DEFINER, ~250 linhas; as 4 colunas entram no INSERT, no VALUES e no ON CONFLICT) e conferir o preflight por hash no padrão da 20261199;
- acrescentar as colunas **no fim** de `v_store_config`;
- escrever o `rollback-manual-*`;
- regenerar `src/types/database.types.ts`;
- provar no Postgres efêmero;
- publicar a migration antes do front pelo `aplicar-migrations.yml`.

Dados existentes: as colunas novas nascem NULL, e `store_address` continua sendo montado para quem já o lê. A Opção B não dispensa a A; ela **só soma** campos estruturados. Custo: ~5 tarefas de RISCO, com o revisor-risco e uma rodada de workflow. O ganho de hoje é marginal: nada no app usa rua ou número separados (a etiqueta usa a conta ME).

**Recomendação:** fazer A agora. B só quando algo exigir campo estruturado, como nota fiscal ou remetente gerado pelo app. **Decisão do dono: P1.**

**4.4 CEP × endereço × remetente do Melhor Envio:**
- **Um CEP só:** o CEP da loja é o CEP de onde saem as entregas (`origin_cep`). Com isso, a cotação, a regra "entrega na sua cidade" (5 primeiros dígitos ou `local_cep_range`) e o rótulo da cidade passam a nascer do mesmo formulário. Se a loja despachar de outro lugar, isso exigiria uma coluna nova. **Decisão do dono: P2.**
- **Divergência que já existe:** se a cidade do CEP salvo ≠ `store_city`, Minha loja avisa: "Seu CEP é de Campinas/SP, mas a cidade cadastrada é São Paulo. Confirme pelo CEP."
- **Remetente da etiqueta:** continua sendo a conta Melhor Envio (`melhor-envio-etiqueta`, `montarRemetente`). Neste plano entra só um aviso estático em Minha loja e no painel de transportadoras: "As etiquetas saem com o endereço da sua conta Melhor Envio — confira se é este mesmo." Conferir automaticamente exigiria a edge function devolver o CEP da conta ME, ou seja, `supabase/functions` (RISCO). Isso fica opcional (Onda I4), **decidido por mim: não agora**.

**4.5 Horário (conserto de perda de dado):** Atendimento deixa de editar e de **enviar** `businessHours`. O editor único é o `BusinessHoursSection`. É a primeira tarefa do plano.

**4.6 Identidade:** Cidade e UF saem dos campos visíveis de `IdentitySettingsSection`. Continuam no pacote de 8 chaves que a `save_store_identity` exige, porque a RPC recusa pacote incompleto. Quem as escreve passa a ser o bloco Endereço, via `updateConfig`. É obrigatório um teste provando que salvar o endereço e depois a marca **não** reverte a cidade nem dá conflito de revisão.

## 5. Um número, um conceito

| Número | Fonte canônica | Quem mostra | Quem deixa de recalcular ou de repetir |
|---|---|---|---|
| Vendas pagas (hoje/mês) | `painel_inicio`, régua "dinheiro que entrou" (spec 26/09 §2: pago, pago_apos_expirar, recebido_na_entrega; data do pagamento, fuso SP) | Início (rótulo "Vendas pagas hoje/no mês") | Pedidos: sai "Receita Hoje" (contava por `created_at`). Relatórios e Financeiro mantêm os seus, com rótulo de período, **depois** da prova I2 |
| Valor médio por venda (ex-ticket) | Relatórios (CRM), no período escolhido | só Relatórios e a Ficha do cliente ("deste cliente") | Pedidos: sai "Ticket Médio" |
| Para preparar | regra do `painel_inicio`: `status IN (new,pending,processing)` e `payment_status` NULL ou fora de (aguardando, expirado, recusado, estornado) — função única `src/lib/pedidos-para-preparar.ts` | Início › Para fazer, selo da aba Pedidos, primeiro KPI de Pedidos | o selo deixa de contar PIX não pago |
| Aguardando pagamento | mesma função, complemento | KPI de Pedidos | — |
| Estoque baixo | `estoque <= COALESCE(estoque_minimo, 5)` | Para fazer, Notificações, Relatórios › Estoque | o front usa uma constante só (`LIMIAR_PADRAO_DE_ESTOQUE`); o SQL do `painel_inicio` passa de 3 para 5 só na I1 (RISCO, **P3**) |
| Devoluções | "Devoluções abertas" = não finalizadas (Início); "Pedindo sua resposta" = solicitadas (sino) | — | os rótulos passam a dizer a janela |
| Contas vencidas, saldo, a receber | Financeiro (`fin_*`) | Financeiro; o Início mostra **um** resumo que leva ao detalhe | a segunda aparição de "Contas vencidas" no Início sai |
| Clientes | Clientes = contas do app; Relatórios › Clientes = quem já comprou (app e balcão) | — | os rótulos dizem a diferença; a Ficha ganha o botão WhatsApp que só o Relatórios tinha |

**Regra:** um número aparece em duas telas só como resumo que leva ao detalhe, com a mesma fonte e o mesmo rótulo. Nenhuma função SQL de dinheiro muda neste plano. A prova de que "vendas pagas" do Início, do CRM e do Financeiro batem é a I2, só leitura no Postgres efêmero. Se não baterem, o alinhamento vira plano próprio (RISCO, `fin_*`).

## 6. Linguagem

**Glossário** (`src/lib/glossario-do-painel.ts`; o técnico vai entre parênteses ou em Avançado):

| Termo técnico | Termo do lojista |
|---|---|
| Dashboard CRM | Relatórios |
| RFM | Grupos de clientes |
| LTV / LTV (Gasto) | Total já comprado |
| Ticket médio | Valor médio por venda |
| Campeões / Leais / Quase dormindo / Não pode perder / Hibernando / Em risco | Melhores clientes / Fiéis / Sumindo / Bons clientes sumindo / Parados há muito tempo / Podem não voltar |
| ROI do Estoque / Capital Alocado / Lucro Potencial / Rendimento % | Retorno do estoque / Dinheiro parado em estoque / Lucro se vender tudo / Margem % |
| DRE / Competência / Margem de contribuição | Resultado do mês / Mês da venda / Sobra depois dos custos da venda |
| SKU / EAN-UPC-GTIN | Código interno / Código de barras |
| Efetivar Variante / Salvar Protocolo / Sobrescrever R$ / Status no Catálogo | Salvar variação / Salvar / Preço diferente nesta variação / Aparece na loja? |
| Q&A / Suporte / SAC | Perguntas |
| Reviews | Avaliações |
| Contato / Role | Contato / Tipo de conta |
| chargeback / Estorno devido | Contestação no cartão / Devolver ao cliente |
| Public Key / Access Token | Chave pública / Chave secreta (em Avançado) |
| Webhooks / Chave de notificações / Assinatura secreta | Aviso automático de pagamento / Senha dos avisos |
| Sandbox | Modo de teste |
| Favicon / Ícone Apple / 192 / 512 / máscara | Ícones do app (avançado) |
| CDC art. 49/26 | Direito de arrependimento (lei: mínimo 7 dias) / Defeito (mínimo 30 dias) |
| Latência / ping / perda de pacotes / Supabase; selo On/Slow/Sync/Off | Conexão boa / lenta / sem internet; selo "Online/Lenta/Sincronizado/Sem internet" |
| "/exemplo-pagina", "https://wa.me/…", "/categoria/calcados" | escolher "Abrir: produto/categoria/…" (o caminho manual vai para Avançado); WhatsApp com DDD |
| MP_ACCESS_TOKEN / segredos do Supabase / flag / frota | "Falta ativar o pagamento pelo app — fale com o suporte técnico" |
| Banners Promocionais / Gerenciador de Banners | Banners |
| Vitrines (Carrosséis) / Vitrines & Carrosséis | Vitrines |
| Engenharia & Cadastro de Produtos / Central de Inteligência & KPIs | Como cadastrar um produto / Como ler os relatórios |
| "Conversão Comercial" (KPI sem valor) | sai: é cartão vazio, não é capacidade |

**Tom de erro:** sempre "o que aconteceu + o que fazer", em frase de pessoa, sem código, tabela, função, "Supabase" ou "migration". O erro bruto vai para o console. A fonte única é `src/lib/erro-do-painel.ts` (`mensagemDeErroDoPainel`, que sai de `crm.ts`, que passa a reexportar). Exceção mantida: o código 22023 que a própria RPC escreve em português para o lojista (contrato de `AdminOrdersView.tsx:952-958`) continua passando direto. Toasts com `${e.message}` (ex.: `AdminAboutStoreView.tsx:201`) passam pela função.

**Ajuda:**
- os títulos do `AdminHelpModal` passam para o glossário;
- a ajuda de Ajustes deixa de falar em "três grupos" e passa a listar os grupos a partir da mesma constante da tela;
- não haverá tour.

## 7. Camada visual (sem design system novo, sem mexer em `ui/*` compartilhado)

**Regras:**
- fundo `bg-admin-bg` no lugar de `#09090b`;
- um ouro só, `admin-gold`, no lugar de `#FFBF00`, `#e3c25e` e `#e2c04a` (o `gold.DEFAULT` do cliente não muda);
- 3 raios: `rounded-xl` para controles, `rounded-2xl` para cartões (o `tile-de-kpi-superficie` já exige) e `rounded-full` para selos;
- texto ≥ 11px (12px preferido); `uppercase font-black tracking-widest` só em etiqueta pequena e título de página; corpo em frase normal;
- contraste: texto secundário ≥ `zinc-400`, e `zinc-500` só a partir de 14px;
- toque ≥ 44px (`min-h-11 min-w-11`);
- largura: listas `max-w-7xl`, formulários `max-w-3xl`.

**Primitivos novos** em `src/components/admin/primitivos/` (só o chunk do painel):
- `FolhaDoPainel` — Radix Dialog, que já está no bundle; `role="dialog"`, Esc, foco preso, "Fechar"; folha de baixo no celular;
- `SeloDeStatus` — ícone + texto + cor;
- `EstadoVazio`;
- `EsqueletoDaLista`;
- `SecaoRecolhivel` — `aria-expanded`; abre sozinha com erro dentro;
- `AtalhosDaAba` — as portas de cada aba, lidas de `PORTAS_DO_PAINEL`;
- `AlternadorDeTelas` — Perguntas | Avaliações;
- `AcaoDoPainel` — botão ≥ 44px.

O `AdminHelpModal` é reimplementado sobre a `FolhaDoPainel` com as mesmas props, e assim as 14 telas ganham acessibilidade de uma vez. **Não se tocam** `ui/dialog.tsx` nem `ui/sheet.tsx`: o "Close" `sr-only` é contrato de teste e é compartilhado com a loja.

**Régua com teto, que só desce** (`tests/front/regua-visual-do-painel.test.ts` + `.json`): conta em `src/views/admin/**` e `src/components/admin/**` as ocorrências de `#09090b`, `#FFBF00`, `#e3c25e`, `#e2c04a`, `text-[6..10(.5)px]` e `fixed inset-0` sem `role="dialog"`. Cada tarefa que toca uma tela baixa o teto daquela tela. Meta no fim da Onda H: 0 para cores literais e texto < 11px nas telas tocadas.

**Tamanho:** o teto não sobe (decidido). Se `npm run size` passar de 450 kB no painel ou se o cliente crescer, a onda para e volta ao dono.

## 8. Primeiros passos (lista guiada, sem tour)

Função pura `src/lib/loja-pronta.ts` → `passosDaLojaPronta(entrada)`, com 6 itens e destino de cada um:
1. Nome e logo → Minha loja.
2. Endereço (CEP + número) → Minha loja.
3. WhatsApp → Minha loja.
4. **Como você recebe** — feito se o PIX estiver OK **ou** se houver alguma forma na entrega → Ajustes › Pagamentos.
5. **Como você entrega** — mesma régua do `StatusDaFaixaFrete`, extraída de `AdminShippingView.tsx:~320` → Entrega e frete.
6. Primeiro produto ativo → Produtos.

O horário é opcional e fica fora da contagem.

**Cartão do Início:** "4 de 6 prontos", **um** botão grande "Próximo passo: …" e a lista recolhida. Com tudo pronto, vira uma linha "Loja pronta para vender". O estoque baixo continua ao lado.

**O mesmo cálculo alimenta:** o "Falta preencher" de Minha loja e o subtítulo de cada grupo de Ajustes. O cartão "Como está sua loja" de Ajustes (4 indicadores) é substituído por esses subtítulos; o indicador "Conexão" vai para Ferramentas › "Minha loja está no ar?".

## 9. Telas gigantes — o básico primeiro, o avançado recolhido

- **Produto (`AdminProductFormView`, 4457 linhas):**
  - aberto: Fotos, Nome, Preço, Estoque, Categoria (os obrigatórios ficam sempre abertos);
  - recolhidos: Descrição e preço "de"; Custo e lucro; Peso e medidas (frete); Variações; Avançado (código interno, código de barras, SEO);
  - seção com erro de validação abre sozinha;
  - nenhuma lógica muda; só embrulho e rótulos.
- **Avisar clientes (`AdminPushView`):** destino escolhido por lista e busca (Início, um produto, uma categoria, Cupons…). O caminho manual vai para Avançado.
- **Banners:** o modo Simples é o padrão e a escolha fica lembrada no aparelho. O Completo continua inteiro.
- **Entrega e frete:**
  - painéis "Na sua cidade" · "Para todo o Brasil" · "Transportadoras", este com o `TransportadorasCard`, que sai do acordeão de Ajustes;
  - "Avançado": estratégias do frete local, etiquetas e consultas de frete, estas vindas de Ajustes › Ferramentas;
  - o e-mail de contato por provedor continua por provedor, porque é o que cada API exige.
- **Pagamentos (Ajustes):**
  - as chaves do Mercado Pago ficam em "Avançado";
  - o status do pagamento aparece uma vez (tile de Pagamentos), e os outros lugares levam a ele;
  - `StatusPagamentoPix` sem `MP_ACCESS_TOKEN`, Supabase nem frota.

## 10. O poder fica

**Não se remove:**
- nenhuma rota;
- nenhum campo, formulário ou RPC;
- nenhuma aba do Relatórios (as 4) nem do Financeiro (as 6);
- PDV;
- devoluções e estornos;
- os modos Simples e Completo dos banners;
- todas as estratégias de frete;
- os provedores;
- `real_time_sales_alerts`;
- cupons;
- variações, códigos e SEO;
- ícones avançados;
- deep links antigos.

**Vai para "Avançado" (recolhido):**
- chaves do Mercado Pago;
- caminho manual do push;
- código interno, código de barras e SEO do produto;
- estratégias do frete local, etiquetas e consultas de frete;
- ícones do app;
- no Financeiro, a aba "Contas e categorias" vai para o fim (é configuração).

**Sai de verdade** (repetição ou vazio, não capacidade):
- "Receita Hoje" e "Ticket Médio" do topo de Pedidos;
- o cartão vazio "Conversão Comercial";
- a segunda aparição de "Contas vencidas" no Início;
- as portas duplicadas.

## 11. Não-objetivos

- Reescrever telas.
- Trocar o tema escuro.
- Mudar rotas.
- Mexer em checkout, webhook, pagamento, service worker ou RLS.
- Mexer no lado da cliente: o "Sobre a Loja" público e o `DevolucaoDoPedidoCard` (ver §15).
- Endereço no recibo.
- Subir o teto de tamanho.
- Tour guiado.
- Fundir PDV e Pedidos (Anular × Cancelar mexem em dinheiro; aqui só entra texto explicando a diferença).

## 12. Decisões que tomei (reversíveis, registradas)

1. **Só rótulos e portas.** As rotas ficam com os mesmos nomes (URLs de push, testes de rota, portão `startsWith("admin")`).
2. **A aba "Ajustes" mantém o nome.** O hub interno de dados se chama "Minha loja".
3. **"Dashboard CRM" vira "Relatórios".** O nome foi dado pelo dono em 26/09; voltar atrás é trocar uma linha em `nomes-do-painel.ts`.
4. **Perguntas e Avaliações:** uma porta e um alternador, mas duas telas (sem fusão de código).
5. **Atendimento entra em Minha loja.** A rota `admin-whatsapp-config` vira apelido.
6. **O selo de Pedidos** deixa de contar PIX não pago (alinha com o Início).
7. **Pedidos perde** "Receita Hoje" e "Ticket Médio".
8. **Remetente ME:** só aviso estático.
9. **O teto de tamanho não sobe.**
10. **Ajustes perde o cartão "Como está sua loja"**, trocado por subtítulos de status por grupo.

## 13. Perguntas ao dono (só as que bloqueiam)

- **P1 — Endereço: Opção A (sem migration) ou B (colunas estruturadas)?** *Recomendo A* (conta no §4.3: ~8 tarefas de ROTINA × ~5 de RISCO mais workflow, para ganho marginal hoje). Só bloqueia a Onda D se a resposta for B. Sem resposta, segue A.
- **P2 — O CEP da loja é o mesmo de onde saem as entregas?** *Recomendo que sim, um CEP só*: é o que mata a divergência, e nada no app hoje separa loja de depósito. Se você despacha de outro endereço, a D6 muda (Frete mantém um "CEP de saída" próprio, o que pede coluna nova, RISCO). Bloqueia a D6.
- **P3 — "Estoque baixo" sem mínimo cadastrado: 5 ou 3?** *Recomendo 5.* Já é a régua do Relatórios, dos avisos e da lista de produtos; só o Início usa 3. Com 5, o número do Início sobe para produtos com 4 ou 5 unidades. Exige migration em `painel_inicio` (RISCO). Bloqueia só a I1.

## 14. Critérios de aceite (medíveis)

1. Toda tela `admin-*` tem um nome em `NOMES_DO_PAINEL`, usado no título, no carregando, na porta e no Voltar. Teste de fonte: nenhum dos nomes antigos (lista do §6) aparece em `src/views/admin` nem em `src/components/admin`.
2. Toda sub-view tem exatamente uma porta em `PORTAS_DO_PAINEL`, sem contar apelidos e filhas de lista (teste).
3. O pai do popstate é igual a `paiDaTelaDoAdmin` para todas as sub-views, inclusive `admin-notifications` (teste).
4. `origin_cep`, `store_address`, `store_city` e `store_state` têm campo editável **só** em `src/components/admin/minha-loja/*`, e `business_hours` só no `BusinessHoursSection` (teste de fonte + teste de payload: Frete e Atendimento não enviam essas chaves).
5. Salvar o endereço faz 1 chamada a `updateConfig` com as 4 chaves; salvar a marca depois não reverte a cidade (teste).
6. A lista de primeiros passos tem 6 itens; uma loja só com "na entrega" marca "Como você recebe" como feito (teste).
7. Selo de Pedidos, KPI "Para preparar" e Início usam `pedidos-para-preparar.ts` (teste com a mesma amostra → o mesmo número).
8. `painel-sem-jargao`: o teto da lista do §6 fora de "Avançado" chega a 0 no fim da Onda G.
9. Régua visual: tetos só descem; meta do §7 cumprida nas telas tocadas.
10. Acessibilidade:
    - a barra inferior tem nome acessível nas 5 abas em qualquer largura;
    - Voltar e sino com ≥ 44px;
    - a ajuda é `role="dialog"` e fecha com Esc.
11. `npm run size`: painel ≤ 450 kB e cliente sem crescer mais de 1 kB.
12. `npm test` inteiro verde em cada onda. Os testes de capacidade existentes continuam passando sem perder asserção de comportamento; só mudam rótulos e portas.

## 15. O que não sei ou não verifiquei

- Não li inteiras `crm__vendas`, `fin_resumo` e `get_admin_analytics_v2`. Não sei se "vendas pagas do mês" bate entre Início, Relatórios e Financeiro; por isso existe a prova I2 antes de mexer em rótulo do CRM e do Financeiro.
- Não confirmei se o UPDATE de `produtos.estoque_minimo` pelo admin passa pelos grants e gatilhos de hoje (a H2 verifica antes; se não passar, vira migration de RISCO).
- Não confirmei a regra de `stats.pending`, usado pelo KPI de Pedidos (a F3 verifica).
- Não confirmei o mapeamento dos códigos de serviço do Melhor Envio (12/15/16/22) para nomes comerciais (a G6 confere na doc do ME antes).
- Não medi o tamanho atual; 402/475 kB vêm da pesquisa.
- Não confirmei como `useStoreIdentityEditor` reage quando `store_city` muda por fora (a D5 prova por teste).
- **Achado fora do painel**, para outra frente, lado da cliente: o `DevolucaoDoPedidoCard` (`OrderDetailsView.tsx:1076`) mostra `config.storeAddress` atual e ignora `politica_devolucao.endereco_devolucao`. Não entra neste plano.
