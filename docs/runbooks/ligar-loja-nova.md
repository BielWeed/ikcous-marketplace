# Ligar uma loja nova de assinante — a receita (nova-loja, org central)

> Reescrito em 27/11/2026 (A23 do plano da org central) para o modelo decidido em 26/11/2026: **a
> IKCOUS é dona de todos os bancos**, numa organização paga só do Supabase ("IKCOUS Lojas"), e **a
> lojista nunca tem conta técnica**. Conferido no código de
> [`scripts/frota/nova-loja.mjs`](../../scripts/frota/nova-loja.mjs) e
> [`scripts/frota/org-central.json`](../../scripts/frota/org-central.json) nesta data.
> Os passos que ainda não estão no comando aparecem marcados como **ainda não existe** ou
> **aguardando**. **Este roteiro ainda não foi ensaiado de ponta a ponta** (B6 do plano).
>
> A criação da organização, o token dos workflows e a transferência da IKCOUS e da Savy para ela
> estão em [org-central-supabase.md](org-central-supabase.md).

## Para quem é cada parte

| Quem lê | O que interessa |
|---|---|
| **O dono (Gabriel)** | [Parte 0](#parte-0--antes-da-primeira-loja-uma-vez-só) (uma vez só) e os passos marcados "**no terminal do dono**" |
| **A lojista** | Só a [Parte 1](#parte-1--a-tela-da-lojista): ela se cadastra na loja e liga o Gmail e o Mercado Pago. Pode copiar o texto e mandar para ela |
| **O agente** | Tudo, principalmente a [Parte 2](#parte-2--os-passos-do-agente-comando-por-comando) |

## Como a coisa funciona, em uma frase

Toda loja nova nasce **dentro da organização "IKCOUS Lojas"** do Supabase (o serviço onde fica o
banco de dados da loja), que é da IKCOUS. O dono autoriza o comando **uma vez só**, para a
organização inteira, e todo passo de toda loja usa essa autorização. A lojista não cria conta em
lugar nenhum além da própria loja.

## O caminho inteiro, em ordem

| # | Quem | O quê | Situação em 27/11/2026 |
|---|---|---|---|
| 0a | Dono | Criar a organização "IKCOUS Lojas" no plano Pro | **01/12** ([receita 6.1](org-central-supabase.md#61--0112-criar-a-organização-e-assinar-o-pro)) |
| 0b | Agente | Gravar o slug da organização em `scripts/frota/org-central.json` (B2) | depois do 0a |
| 0c | Dono | O OAuth App de produção (a "chave de entrada" da IKCOUS no Supabase) | uma vez só |
| 0d | Dono | `autorizar`: a autorização da organização inteira | comando pronto |
| 0e | Dono e agente | O segredo dos workflows e a prova de que ele só enxerga a organização | workflow pronto (`medir-token-da-org.yml`) |
| 1 | Agente | `endereco`: reservar `<slug>.vercel.app` na Vercel, **antes** do projeto (o projeto custa por hora) | **ainda não existe** (A11) |
| 2 | Agente | `criar-projeto`: cria o projeto da loja na organização central | comando pronto |
| 3 | Agente | `banco`: instala o banco inteiro | comando pronto |
| 4 | Agente | `ficha`: confere a ficha da loja e gera o texto do cadastro | comando pronto |
| 5 | Agente | `dominio`: grava o domínio da loja na ficha | comando pronto |
| 6 | Agente | `segredos`: os segredos da loja | comando pronto |
| 7 | Agente | `cadastro`: a loja entra na frota (`lojas.json`, canais, workflows) | **aguardando** (A9, A10 e A12) |
| 8 | Agente | `functions`: publica as functions da loja | no comando, mas **depende do 7** |
| 9 | Agente | `login`: endereços do login e gancho de e-mail desligado | comando pronto |
| 10 | Agente | `marca` | **aguardando** (A13) |
| 11 | Agente | `chave-do-plano` | **aguardando** (A14) |
| 12 | Lojista | **Parte A**: se cadastra NA LOJA com o e-mail da dona | ver a [lacuna do e-mail](#a-confirmação-do-e-mail-da-lojista-não-chega-lacuna) |
| 13 | Dono | `primeira-admin`: ela vira administradora | comando pronto |
| 14 | Agente | `definir-dono`: a administradora única vira a dona | comando pronto |
| 15 | Lojista | **Parte B**: liga o Gmail e o Mercado Pago no painel | — |
| 16 | Agente | Ligar o gancho de e-mail e subir o limite de e-mails | depende do 7 |
| 17 | Agente | `conferir`: a loja está pronta para vender? | comando pronto (só lê) |

**Hoje (27/11/2026) nenhuma loja real se abre por este caminho.** A organização central só existe
a partir de 01/12, e os passos 1, 7, 10 e 11 ainda não existem. Do jeito que está, o comando anda
de `criar-projeto` até `login` numa loja de ensaio, e para no `cadastro`.

## Regras que valem em todos os passos

- **Segredo nunca vai para o chat.** O client secret do OAuth App, o código da autorização, o
  token dos workflows e o e-mail da lojista se digitam **só no terminal do dono**, quando o
  comando pede. Nenhum comando aceita esses valores como argumento, porque a linha de comando fica
  no histórico do PowerShell. Neste documento, todo valor que é segredo aparece como `<cole-aqui>`.
- **Nunca mande print do terminal.** O que você cola **fica visível na tela** (o comando não
  esconde). Se precisar mostrar um erro, copie só a linha da mensagem.
- **Sem `--aplicar`, nada acontece de verdade.** O comando só lê e diz o que faria. Esse é o
  **ensaio**. Rode sempre o ensaio antes, e depois o mesmo comando com `--aplicar`.
- **No ENSAIO, o veredito não é SIM.** Sem `--aplicar`, INCERTO ou NÃO é o esperado. O que vale
  no ensaio é a frase que começa com `ENSAIO`: ela diz o que o comando faria.
- **Todo passo termina com SIM, NÃO ou INCERTO.**
  - **SIM**: deu certo e foi conferido. Siga para o próximo passo.
  - **NÃO**: não fez, ou recusou de propósito. A mensagem diz o motivo. Não insista sem ler.
  - **INCERTO**: o comando não conseguiu confirmar o que aconteceu (internet, demora, resposta
    estranha). **INCERTO nunca é SIM.** Quase sempre se resolve rodando o mesmo comando de novo,
    porque os passos retomam de onde pararam.
- **O número que o comando devolve** fica em `$LASTEXITCODE`: `0` = SIM, `1` = NÃO,
  `2` = INCERTO.
- **Troque os marcadores pelo valor, sem os sinais `<` e `>`.** Onde está `<slug>`, escreva por
  exemplo `minhaloja`. No PowerShell 5.1, colar o marcador como está (`<slug>`) dá erro, porque
  `<` é um símbolo do próprio PowerShell.
- **PowerShell 5.1**: nada de `&&`. Um comando por vez.
- **O apelido da loja (`<slug>`)** usa minúsculas, dígitos e hífen. Começa com letra, tem **até 24
  caracteres** e **não termina em hífen**. Também não pode ser `org-ikcous-lojas` (a chave da
  autorização da organização) nem `lojas` (o segredo da loja seria o da organização): o comando
  recusa os dois. Escolha uma vez e não troque: é a chave do estado e do cadastro.
- **IKCOUS e Savy nunca passam por estes passos.** Elas já vendem. O comando recusa os passos da
  dona nelas, e o `criar-projeto` nunca adota o projeto delas nem o de qualquer loja do
  `lojas.json`.

### Abrir o terminal no lugar certo

1. No Windows, abra o menu Iniciar, digite **Windows PowerShell** e clique nele. É o PowerShell
   azul, versão 5.1.
   - **O que aparece:** uma janela com uma linha que termina em `>`.
2. Vá até a pasta do repositório. Deixe o caminho entre aspas duplas:

   ```powershell
   Set-Location "<pasta do repositório ikcous-marketplace no seu PC>"
   ```

   - **Como saber que deu certo:** `Test-Path scripts/frota/nova-loja.mjs` responde `True`.
   - **Se responder `False`:** a pasta está errada. Pare e me chame.
3. **O checkout tem de ser o da release aprovada** (o topo da branch
   `claude/app-major-upgrade-wmc8x2` no GitHub). O passo `banco` instala as migrations **desse
   commit**, e o `functions` publica o código desse commit: versão errada = loja montada com código
   errado. Os dois **recusam sozinhos** (NÃO, sem mandar nada ao Supabase) se o checkout não estiver
   exatamente no topo, mas **quem confere isso antes é o agente**, antes de você rodar qualquer passo.

### Onde o comando guarda as coisas (no PC do dono, fora do repositório)

| Pasta | O que tem | Segredo? |
|---|---|---|
| `$env:LOCALAPPDATA\ikcous\frota\nova-loja\<slug>.json` | o andamento de cada loja: qual passo deu SIM, o ref do projeto | não |
| `$env:LOCALAPPDATA\ikcous\frota\nova-loja\org-ikcous-lojas.json` | o andamento da autorização da organização | não |
| `$env:LOCALAPPDATA\ikcous\frota\acesso\org-ikcous-lojas.dpapi` | o client secret e a autorização da organização, cifrados pelo Windows | **sim** |
| `$env:LOCALAPPDATA\ikcous\frota\banco\<slug>.dpapi` | a senha do banco de cada loja, cifrada pelo Windows | **sim** |

Os arquivos `.dpapi` só abrem com a mesma conta do Windows, neste PC. Não copie, não mande, não
abra. O backup deles é o `scripts/frota/backup-do-cofre.mjs`.

---

## Parte 0 — Antes da primeira loja (uma vez só)

### A organização central

A organização "IKCOUS Lojas", no plano Pro, e o slug dela em
[`scripts/frota/org-central.json`](../../scripts/frota/org-central.json). Receita:
[org-central-supabase.md, 6.1](org-central-supabase.md#61--0112-criar-a-organização-e-assinar-o-pro).
Enquanto o `slug` estiver `null` nesse arquivo, o `criar-projeto` responde NÃO (`org central ainda
não criada`) sem tocar a rede.

### O OAuth App de produção (o dono faz)

**O que é:** o "cadastro" da IKCOUS dentro do Supabase. É ele que mostra a tela "Authorize IKCOUS"
quando o dono autoriza a organização. Cria-se **uma vez**.

1. No seu Chrome, abra `https://supabase.com` e entre na conta da IKCOUS.
   - **O que aparece:** a lista das suas organizações.
2. Clique na organização **"ikcous - BDfree"**.
3. No menu da esquerda, clique em **Organization settings** e depois em **OAuth Apps**.
   - **O que aparece:** a lista de OAuth Apps, com o botão **Publish OAuth app**. Pode já ter o
     app da prova de 26/11 ("IKCOUS Provisionador (prova)"). **Não mexa nele.**
4. Clique em **Publish OAuth app** e preencha:
   - **Nome:** `IKCOUS`
   - **Redirect URLs (endereços de volta)**, os dois:
     - `https://<endereço do app de gestão>/autorizado`
     - `http://localhost:8787/callback`
   - **Escopos:**

     | Categoria | Marcar |
     |---|---|
     | Projects | Read e Write |
     | Database | Read e Write |
     | Edge Functions | Read e Write |
     | Secrets | Read e Write |
     | Auth | Read e Write |
     | Organizations | só Read |
     | Domains, Environment, Rest, Storage | **nada** |

   O passo `marca` (A13) lê a chave de serviço da loja; se esse escopo não bastar, o ensaio M1 do
   plano diz qual falta, e esta tabela muda antes da primeira loja.
5. Clique em **Publish**.
   - **O que aparece:** o **Client ID** e o **Client Secret** do app.
6. **O Client ID** não é segredo: pode me mandar no chat.
7. **O Client Secret é segredo.** Não mande no chat, nem em print. Guarde no seu gerenciador de
   senhas. Ele vai ser **digitado por você no terminal**, no `autorizar`.

**Como saber que deu certo:** o app "IKCOUS" aparece na lista, com os escopos acima.

**Se aparecer diferente:** se o Supabase mudou o nome de algum botão ou categoria, pare e me
mande um print **da tela sem o Client Secret**.

**Cuidado:** não gere um Client Secret novo sem falar comigo. O cofre guarda o secret da época da
autorização, e a renovação usa esse valor. Um secret novo corta o acesso a todas as lojas até o
`autorizar` ser feito de novo.

### `autorizar` — a autorização da organização (no terminal do dono)

**O que faz:** em duas rodadas, guarda no cofre do PC **uma** autorização, a da organização
"IKCOUS Lojas", sob a chave `org-ikcous-lojas`. Todo passo de toda loja usa essa autorização: cada
rodada renova o acesso uma vez e ele só existe na memória. `autorizar` não leva `--loja`.

1. Abra o pedido:

   ```powershell
   node scripts/frota/nova-loja.mjs autorizar --client-id <client id do OAuth App> --redirect "https://<endereço do app de gestão>/autorizado" --aplicar
   ```

   - **O que aparece:** `Cole o client_secret do OAuth App da IKCOUS e tecle Enter:`. Cole
     `<cole-aqui>` e tecle Enter. Depois aparece um link e o texto "Para o DONO, no navegador
     dele".
2. Abra o link no Chrome. Vai aparecer "Authorize IKCOUS", com uma lista de organizações.
   **Marque só "IKCOUS Lojas"** (a tela pode abrir com outra marcada) e clique em **Authorize**.
   - **O que aparece:** uma página com um código e o botão **Copiar**.
3. Copie o código e, no PowerShell:

   ```powershell
   node scripts/frota/nova-loja.mjs autorizar --receber --aplicar
   ```

   - **O que aparece:** `Cole o código da autorização da org (ou o endereço inteiro) e tecle
     Enter:`. Cole e tecle Enter.

- **SIM:** `autorização da org recebida`.
- **NÃO:**
  - `autorizar precisa de --client-id e --redirect`: faltou um dos dois.
  - `a org central não tem autorização aberta`: falta a rodada 1.
  - `autorizar é da org central inteira: não leva --loja`: tire o `--loja`.
  - Código recusado: venceu, foi usado duas vezes ou veio de um link antigo. Rode a rodada 1 de
    novo.
- **INCERTO:** não cole o mesmo código de novo (ele é de uso único). Rode a rodada 1 de novo.
- **Autorizou a organização errada?** O `criar-projeto` percebe: ele para com `a autorização tem de
  cobrir exatamente a organização ...` e nada é criado. Rode o `autorizar` de novo marcando só
  "IKCOUS Lojas".

### O segredo dos workflows

O token que os workflows do GitHub usam (`SUPABASE_ACCESS_TOKEN_LOJAS`) e a prova de que ele só
enxerga a organização central: receita em
[org-central-supabase.md](org-central-supabase.md#o-token-dos-workflows-e-a-prova-do-escopo).
Nenhuma loja da organização entra no cadastro antes do `medir-token-da-org.yml` dar verde.

---

## Parte 1 — A tela da lojista

> Esta parte pode ser copiada e mandada para a lojista do jeito que está.

### Antes de tudo: de quem é a loja

1. **Você não precisa criar conta em nenhum serviço técnico.** A loja inteira é montada pela
   IKCOUS.
2. **A dona se cadastra na loja com o e-mail de quem é DONA do negócio**, a pessoa que recebe o
   dinheiro das vendas. Essa conta vira a dona da loja: só ela troca a conta do Mercado Pago e o
   Gmail da loja, e só ela dá ou tira o cargo de administrador.
3. **Funcionário que vira administrador** cuida de pedidos e produtos, mas **não** muda para onde
   vai o dinheiro.
4. **Trocar de dona** (venda da loja ou erro no cadastro) é um pedido **por escrito** à IKCOUS,
   **nunca** pelo painel. Quem pede é a **assinante do contrato**: a pessoa que contratou e paga a
   loja. A IKCOUS confirma o pedido pelo contato que **já estava cadastrado** antes dele.

### Parte A — se cadastrar na loja (quando a IKCOUS avisar que a loja está no ar)

1. Abra o endereço da sua loja, que a IKCOUS vai mandar.
2. Toque em **Criar conta** e use **o e-mail da dona**.
3. Confirme o e-mail pelo link que chegar. Olhe no Spam também. Se não chegou em 15 minutos, avise
   a IKCOUS e **não peça para reenviar várias vezes**.
4. Entre na loja uma vez e avise a IKCOUS: "confirmei".

### Parte B — no painel (quando a IKCOUS avisar que você já é a administradora)

1. **Saia da loja e entre de novo.** Sem isso, o painel não aparece.
2. **Gmail da loja:** Painel > **Ajustes** > **Minha loja** > **E-mail da loja**. Siga o passo a
   passo da própria tela: um Gmail só da loja, verificação em duas etapas, senha de app, colar,
   **Salvar** e **Enviar e-mail de teste**. O e-mail de teste aparece em **Enviados**.
3. **Mercado Pago:** Painel > **Ajustes** > **Pagamentos** > **Mercado Pago** > **Avançado: chaves
   do Mercado Pago** > **Suas chaves**. Siga o guia da tela, **Salvar** e **Testar conexão**.
4. Avise a IKCOUS que terminou.

**Como saber que deu certo:** o e-mail de teste aparece em Enviados, e o teste do Mercado Pago diz
que a conexão está certa.

**Se aparecer diferente:** a frase "esta loja ainda não está preparada" ou "este recurso ainda não
está disponível" é do nosso lado, não do seu. Mande um print para a IKCOUS.

---

## Parte 2 — Os passos do agente, comando por comando

Tudo na pasta do repositório, numa janela de Windows PowerShell 5.1 aberta como em
[Abrir o terminal no lugar certo](#abrir-o-terminal-no-lugar-certo), no checkout da release
aprovada. Antes de cada passo, rode o ensaio (o mesmo comando sem `--aplicar`) e leia o que ele
diria. Todo passo leva `--loja <slug>`.

### Passo 1 — `endereco` — ainda não existe

Vai reservar `<slug>.vercel.app` no projeto da Vercel **antes** de criar o projeto do banco: o
projeto custa por hora, e um nome que outra conta já usa tem de ser descoberto antes (A11 do
plano). **Até ele existir, nenhuma loja real começa.** O passo `dominio` (5) grava esse mesmo
endereço na ficha da loja.

### Passo 2 — `criar-projeto`

**O que faz:**
1. Lê a organização central de `scripts/frota/org-central.json` (não precisa de `--org`).
2. Confere que a autorização cobre **exatamente** essa organização.
3. Procura um projeto chamado `ikcous-<slug>` (um pedido anterior pode ter criado e perdido a
   resposta). **Recusa** o projeto achado se o ref dele for da IKCOUS, da Savy, de qualquer loja do
   `lojas.json` ou de um canal de outra loja.
4. Se não achar, cria o projeto em `sa-east-1` (São Paulo). A senha do banco é gerada forte e
   guardada **só** no cofre, antes do pedido.
5. Espera o projeto ficar `ACTIVE_HEALTHY`, consultando de 10 em 10 segundos por até 5 minutos.

```powershell
node scripts/frota/nova-loja.mjs criar-projeto --loja <slug> --aplicar
```

- **SIM:** `projeto <ref> pronto (ACTIVE_HEALTHY) em sa-east-1`.
- **NÃO:**
  - `org central ainda não criada`: o slug de `org-central.json` ainda é `null` (Parte 0).
  - `a autorização tem de cobrir exatamente a organização ...`: rode o `autorizar` de novo,
    marcando só "IKCOUS Lojas".
  - `o projeto <ref> é de uma loja que já vende`, `é da loja ... do lojas.json` ou `é um canal de
    outra loja`: o nome `ikcous-<slug>` já é de outra loja. Escolha outro `<slug>`.
  - `HTTP 402`: fatura atrasada na organização central. O dono confere Billing no painel.
  - `INIT_FAILED`, `REMOVED` e outros estados sem volta: o comando **não** apaga nem recria
    sozinho. É decisão do dono.
  - `há N projetos chamados ikcous-<slug>`: pare e leve ao dono. O comando não escolhe.
- **INCERTO:**
  - `não ficou ACTIVE_HEALTHY em 5 min`: espere uns minutos e rode o mesmo comando. A retomada só
    confere o status, **não cria outro projeto**.
  - `O projeto PODE ter sido criado`: rode de novo. A retomada procura pelo nome antes de criar, e
    a senha no cofre é a mesma.

### Passo 3 — `banco`

**O que faz:** instala o banco inteiro, uma migration por pedido. Cada migration vai junto com o
seu registro no ledger (a lista do que já foi aplicado), na mesma transação: ou os dois entram, ou
nenhum. Só diz SIM depois de reler o banco e conferir que a fila **inteira** está no ledger e a
instalação está marcada como concluída.

```powershell
node scripts/frota/nova-loja.mjs banco --loja <slug> --aplicar
```

- **SIM:** `Conferido: as N migrations da fila estão no ledger e a instalação está marcada como
  concluída.`
- **NÃO:**
  - `rode criar-projeto --aplicar até dar SIM antes de banco`: falta o passo 2.
  - `RECUSADO: o HEAD local (...) não é o topo de origin/<branch> (...)`: o checkout não é o da
    release aprovada (outra branch, ou a release andou). Nada foi enviado ao banco e o estado não
    mudou. Faça checkout do SHA que a mensagem mostra e rode de novo. O `banco` lê as migrations
    **do commit**, não da pasta: um arquivo solto ou editado na pasta nunca vai para a loja.
  - `não consegui ler as migrations do commit aprovado ... pelo git`: o `git` não respondeu nesta
    pasta. Nada foi enviado. Rode `git status` na mesma janela; se der erro, pare e me chame.
  - `FALHOU em <arquivo> (código ...)`: o banco recusou aquela migration, e nada dela ficou
    gravado. Leve o arquivo e o código ao programador antes de rodar de novo.
  - `RECUSADO: ... loja já instalada` numa loja que **não** foi este comando que instalou (sem a
    marca de instalação): esse instalador não mexe em loja que já existe. Pare.
  - A mesma recusa numa loja que **já está no cadastro da frota** (`lojas.json`): as migrations
    novas dela vão pelo `aplicar-migrations.yml` (portão da release), nunca por aqui. Se o `banco`
    já tinha dado SIM, a mensagem termina com `O SIM do banco desta loja foi mantido`: os passos
    seguintes continuam liberados e nada foi gravado.
  - `o ledger registra ..., que não existe no repositório deste checkout`: o checkout está velho.
    Atualize o checkout e rode de novo. Se o `banco` já tinha dado SIM, ele continua SIM.
- **Rodou de novo depois de uma release nova?** Se esta loja foi instalada por este comando e
  ainda não está no cadastro da frota, o `banco --aplicar` aplica **só as migrations novas do
  fim** (cada uma com o registro no ledger, na mesma transação) e termina SIM. Não precisa fazer
  nada diferente.
- **INCERTO:** `ESTADO DESCONHECIDO ... a resposta não veio`: **rode o mesmo comando de novo**. Ele
  relê o ledger e continua do ponto certo. Erro 429: ver
  [as armadilhas](#a-instalação-do-banco-bate-no-limite-de-pedidos-por-minuto).

### Passo 4 — `ficha`

**O que faz:** só leitura. Confere que a ficha da loja (`public.store_config`, linha `id = 1`)
existe e foi criada pela migration certa, e **gera, sem executar,** o texto do cadastro: a linha da
caderneta da frota (`frota_lojas`) e a entrada de `scripts/frota/lojas.json`. A entrada já sai com
o segredo **da organização** (`SUPABASE_ACCESS_TOKEN_LOJAS`, o de `org-central.json`), nunca um
segredo por loja.

```powershell
node scripts/frota/nova-loja.mjs ficha --loja <slug> --aplicar
```

Use `--nome "<Apelido>"` se o apelido da loja não for o próprio `<slug>`.

- **SIM:** a saída traz o SQL da caderneta e a entrada de `lojas.json`. **Guarde as duas** para o
  passo 7.
- **NÃO:** `a ficha (public.store_config id = 1) não existe`: a migration `20261540000000` não
  rodou nesse banco. Pare. Não crie a linha à mão.

### Passo 5 — `dominio`

**O que faz:** grava `<slug>.vercel.app` na ficha (`store_config.dominio_publico`). Sem ele, a
vitrine responde "Esta loja está em manutenção". Só grava se o domínio estiver **vazio** (nunca
sobrescreve) e relê depois.

```powershell
node scripts/frota/nova-loja.mjs dominio --loja <slug> --aplicar
```

- **SIM:** `a ficha agora declara o domínio <slug>.vercel.app`, ou `a ficha já declara o domínio`
  (nada foi gravado).
- **NÃO:** `a ficha já declara OUTRO domínio`: ele **não** sobrescreve. Leve ao programador.
  `SQLSTATE 42501`: a trava do banco não deixou. **Não** grave pelo SQL Editor.
- **INCERTO:** rode o mesmo comando de novo: ele lê antes e não escreve duas vezes.

### Passo 6 — `segredos`

**O que faz:** grava os segredos da loja (a chave que cifra as credenciais do Mercado Pago e do
Gmail, o segredo da reconciliação de pagamentos nas functions e no Vault, e o par de chaves das
notificações), pelo `scripts/frota/segredos-da-loja.mjs`, com a autorização da organização. Nunca
substitui o que já existe e nunca imprime valor.

```powershell
node scripts/frota/nova-loja.mjs segredos --loja <slug> --aplicar
```

- **NÃO:** `rode banco --aplicar até dar SIM antes dos segredos`: falta o passo 3.
- **INCERTO:** rode `conferir --aplicar` (só lê) e depois `segredos --aplicar` de novo: ele grava
  só o que falta.

### Passo 7 — `cadastro` — aguardando

O comando responde NÃO de propósito, sem tocar a rede. Falta: a loja nova nascer com o segredo da
organização no cadastro (A9), o endereço de reserva no cadastro (A10) e ligar o passo (A12).
**Não cadastre à mão** pelo roteiro de [producao-unica-fonte.md](producao-unica-fonte.md): ele
manda gravar um segredo por loja no GitHub, e no modelo central o segredo é um só, o da
organização.

### Passo 8 — `functions`

**O que faz:** publica uma por uma as functions do canal da loja, cada uma com o `verify_jwt` do
`supabase/config.toml`, e confere cada uma antes da próxima. Só pula a que já está no ar com o
`verify_jwt` certo **e o mesmo código** do commit (comparado do mesmo jeito que o portão da
release compara: baixa o código no ar pelo CLI do Supabase). A que tem código diferente (uma
release nova mudou) é publicada de novo, e só conta quando a versão no ar sobe. O download tenta
primeiro com a autorização da organização (a mesma do resto do comando) e, se ela não servir, com
o login do CLI `supabase` deste PC. Se os dois falharem, a function é publicada de novo do mesmo
jeito, e a saída diz a causa provável e o que fazer (`supabase --version` tem de responder;
`supabase projects list` tem de mostrar o projeto; se não mostrar, `supabase login` com uma conta
da organização — quem digita é o dono, na tela dele). Só publica com o checkout **exatamente** no
topo da branch da release.

```powershell
node scripts/frota/nova-loja.mjs functions --loja <slug> --aplicar
```

**Na prática espera o passo 7:** o canal da loja tem de estar em `lojas.json` e em
`scripts/frota/canais-de-backend.json`, e é o cadastro que põe a loja lá.

### Passo 9 — `login`

**O que faz:** acerta os endereços do login (`site_url` e a lista de endereços de volta, no
domínio `<slug>.vercel.app`) e prepara o gancho de e-mail **desligado**, com o segredo gravado nas
duas pontas. Ligado antes do Gmail, todo e-mail de login falharia.

```powershell
node scripts/frota/nova-loja.mjs login --loja <slug> --aplicar
```

- **INCERTO:** rode `conferir --aplicar` (só lê) e veja o item login antes de repetir.

### Passos 10 e 11 — `marca` e `chave-do-plano` — aguardando

O comando responde NÃO de propósito, sem tocar a rede. A `marca` (A13) vai ler a chave de serviço
da loja pela autorização da organização, só na memória; a `chave-do-plano` (A14) vai imprimir o
`gh workflow run instalar-chave-da-loja.yml` quando a loja estiver no `lojas.json` da branch base.
Sem a marca, a vitrine mostra "Esta loja está em manutenção" e a lojista não consegue se cadastrar
(Parte A).

### Passo 13 — `primeira-admin` (no terminal do dono)

Vem **depois** que a lojista se cadastrou na loja e confirmou o e-mail (Parte A).

**O que faz:** transforma a conta dela na **primeira** administradora. Só age se existe exatamente
1 conta com esse e-mail, o e-mail está confirmado e a loja tem 0 administradoras. Tudo numa
transação só. Se a mesma pessoa já é a administradora única, diz SIM sem gravar.

```powershell
node scripts/frota/nova-loja.mjs primeira-admin --loja <slug> --aplicar
```

- **O que aparece:** `Digite o e-mail da administradora (o mesmo com que ela se cadastrou NA LOJA)
  e tecle Enter:`. Digite o e-mail e tecle Enter. O e-mail vai só ao banco da loja: nunca ao
  estado, à saída nem à mensagem.
- **SIM:** diga à lojista para **sair e entrar de novo**.
- **NÃO:** `nenhuma conta com esse e-mail`, `ainda não confirmou o e-mail`, `a loja já tem outra
  administradora`: a mensagem diz qual. Nos dois primeiros, peça à lojista e rode de novo; no
  terceiro, pare e leve ao dono.

### Passo 14 — `definir-dono`

**A regra, decidida pelo sócio:** a **única** administradora da loja vira a dona, lida do banco,
**sem pedir e-mail**. Com um dono diferente já cadastrado, ou com 0 ou 2 ou mais administradoras,
o passo dá **NÃO** e não escolhe ninguém. Só roda em loja aberta pelo `nova-loja.mjs`, nunca na
IKCOUS nem na Savy.

```powershell
node scripts/frota/nova-loja.mjs definir-dono --loja <slug> --aplicar
```

### Passo 16 — Ligar o gancho de e-mail e subir o limite — depende do cadastro

**Depois que a lojista ligou o Gmail** (Parte B), o gancho de e-mail tem de ser ligado pelo
workflow `ativar-email-do-login.yml`, e depois o `login --aplicar` roda de novo (o limite de 30
e-mails por hora só é gravado com remetente próprio). O workflow só aceita lojas do `lojas.json`;
com a loja cadastrada no segredo da organização (passo 7), o gerador
`scripts/frota/lojas-nos-workflows.cjs` entrega a ela o segredo da organização. **Isso ainda não
foi medido numa loja real** (B6).

### Passo 17 — `conferir`

Só leitura: a lista do que torna a loja pronta para vender, item por item.

```powershell
node scripts/frota/nova-loja.mjs conferir --loja <slug> --aplicar
```

- Cada linha começa com `[SIM]`, `[NÃO]`, `[INCERTO]` ou `[ATENÇÃO]`. **`[ATENÇÃO]`** é o que
  depende da lojista (ou o que o comando não consegue ler sozinho): não é defeito da instalação,
  mas a loja **não** está pronta para vender enquanto ele existir.
- **`e-mail de confirmação`:** SIM só com o gancho de e-mail ligado **e** o Gmail da loja
  cadastrado. ATENÇÃO enquanto a lojista não cadastra o Gmail (Parte B). NÃO se o gancho está
  ligado sem o Gmail (todo e-mail falha) ou se o Gmail existe e o gancho continua desligado
  (passo 16).
- **`mercado pago`:** sempre ATENÇÃO, "a conferir pela lojista no painel": o comando não lê se o
  Mercado Pago está ligado. Confira com a lojista antes de dizer que a loja vende.
- **`banco`** com a instalação concluída e migrations novas faltando diz qual é o caminho: `banco
  --aplicar` (loja ainda fora do cadastro) ou o `aplicar-migrations.yml` (loja do cadastro).
- **`functions`** só dá SIM com o código no ar igual ao do commit; INCERTO se o download do código
  falhou, e aí o item já diz a causa provável e o que fazer (o mesmo roteiro do passo 8).
- A frase `a loja está pronta para vender` só aparece com **todos** os itens SIM.

### Trocar a dona — `trocar-dono` (raro; só com o pedido escrito)

**Quando:** a loja foi vendida, a dona cadastrada saiu do negócio, ou o cadastro saiu com a pessoa
errada. A troca muda para quem vai o dinheiro: as chaves do Mercado Pago e do Gmail passam a ser da
nova dona. Por isso ela **nunca** sai de uma mensagem solta.

**Antes do comando, o procedimento (decisão do sócio, 26/11/2026):**

1. **Quem pode pedir é a assinante do contrato:** a pessoa cadastrada na gestão, a que paga a
   loja. Não é "quem tem o e-mail de administradora". Quando não é a mesma pessoa (a funcionária
   que saiu, a loja vendida), vale a assinante.
2. **O pedido é por escrito** e diz qual é a loja e o e-mail com que a nova dona entra **na loja**.
3. **A confirmação vai sempre por um contato que já estava cadastrado antes do pedido:** o
   WhatsApp da gestão ou o e-mail da administradora. **Nunca** por um telefone ou e-mail que veio
   no próprio pedido.
4. **Se a dona de hoje (a cadastrada na loja) não for a assinante,** avise a dona de hoje pelo
   contato cadastrado. Ela tem **48 horas** para contestar. Se ela contestar, pare e leve ao dono.
5. **A nova dona já tem de ser administradora da loja**, com o e-mail confirmado. Quem dá o cargo
   é a dona de hoje, no painel. Se a dona de hoje não der, pare e leve ao dono.
6. **Guarde o pedido escrito e a confirmação.** O banco não registra a troca em lugar nenhum: o
   `cargo_log` só registra mudança de cargo feita pelo painel.

**O comando, no terminal do dono.** Primeiro o ensaio:

```powershell
node scripts/frota/nova-loja.mjs trocar-dono --loja <slug>
```

- **Vai aparecer:** uma linha `[trocar-dono] INCERTO: ENSAIO ...` dizendo o que faria. Nada é
  pedido nem gravado.

Depois, de verdade:

```powershell
node scripts/frota/nova-loja.mjs trocar-dono --loja <slug> --aplicar
```

Ele pede três coisas, uma de cada vez. Em cada uma, digite e tecle Enter:

1. **O e-mail da NOVA dona**, o mesmo com que ela entra na loja. O comando confere no banco que a
   troca é possível. Se não for, ele para aqui com `NÃO` e o motivo.
2. **Confirmação 1 de 2: o nome da loja**, igual ao que está no `--loja`.
3. **Confirmação 2 de 2: as 2 primeiras letras do e-mail da dona de HOJE.** O comando confere essas
   letras no banco sem ler o e-mail dela.

Se o nome ou as letras estiverem errados, o comando diz `NÃO` e **não escreve nada**.

**Deu certo se** a última linha for `[trocar-dono] SIM:` seguida de "agora é a dona da loja". O
e-mail aparece cortado (2 letras, `•••` e o domínio). A dona antiga continua administradora até a
nova tirar o cargo dela.

**Se aparecer diferente:**

- **`NÃO` com uma frase de motivo:** nada foi trocado. A frase diz o que falta.
- **`INCERTO`:** não repita no escuro. Rode `conferir --aplicar` (só lê) e leve o resultado ao
  programador. Repetir o `trocar-dono` é seguro: se a nova já for a dona, ele diz `SIM` sem gravar.

---

## Parte 3 — Armadilhas

### A confirmação do e-mail da lojista não chega (lacuna)

Enquanto o gancho de e-mail está desligado, quem manda o e-mail de login é o serviço padrão do
Supabase, que só entrega para **os membros da organização dona do projeto**, 2 por hora. No modelo
antigo a lojista era dona da organização e recebia. **No modelo central, a organização é da
IKCOUS: a lojista não é membro, e pela documentação do Supabase a confirmação dela não chega.** Sem
e-mail confirmado, o `primeira-admin` recusa, e sem administradora ninguém liga o Gmail no painel.
**Isso tem de ser resolvido antes da primeira loja real** (decisão que volta para o plano), e o
ensaio B6 mede.

### Ctrl-C no meio de uma espera deixa uma trava órfã

`criar-projeto` espera até 5 minutos e `banco` faz centenas de pedidos. Se você interromper com
Ctrl-C, pode sobrar um arquivo `.trava`, e o próximo comando recusa. **A mensagem do script diz o
caminho exato do arquivo.** Antes de apagar, confira que nenhum comando da loja está rodando (nenhuma
outra janela com `node scripts/frota/...`). Depois:

```powershell
Remove-Item "<caminho que a mensagem mostrou>"
```

E rode o mesmo comando de novo: ele retoma de onde parou. A autorização da organização é uma só:
**dois comandos de lojas diferentes ao mesmo tempo** também se travam (o segundo responde NÃO sem
fazer nada). Rode uma loja por vez.

### A instalação do banco bate no limite de pedidos por minuto

O `banco` faz centenas de pedidos, e o Supabase aceita cerca de **120 por minuto**. Quando passa,
ele responde 429, e o comando trata como INCERTO. **Espere um minuto e rode o mesmo comando de
novo:** ele relê o ledger e retoma de onde parou.

### Projeto novo leva até uns 5 minutos para ficar pronto

Se o `criar-projeto` der INCERTO por tempo, espere e rode de novo: ele não cria outro projeto.

### O código do `autorizar` é de uso único

Colou o código e deu INCERTO? Não cole o mesmo código de novo. Rode a rodada 1 do `autorizar`.

---

## Parte 4 — Como desfazer

| Passo | Como desfazer |
|---|---|
| `autorizar` | Revogar no painel do Supabase: organização "IKCOUS Lojas" > Organization settings > OAuth Apps > Authorized apps > Revoke (confira o nome na tela). Depois disso, todo passo de toda loja para até um `autorizar` novo. |
| `criar-projeto` | O comando **nunca apaga projeto**. Apagar ou pausar é no painel da organização central, e é decisão do dono (cada projeto custa por hora). |
| `banco` | **Não tem desfazer.** Numa loja sem venda, o caminho é apagar o projeto e começar de novo (decisão do dono). |
| `ficha` | Não tem o que desfazer: só lê e imprime. |
| `dominio` | **Sem comando de desfazer.** Ele só grava num domínio vazio. Domínio errado: leve ao programador. |
| `segredos` | Sem comando de desfazer. O script nunca substitui; segredo de mais se apaga no painel do projeto (Edge Functions > Secrets), que agora é da IKCOUS. |
| `functions` | Sem comando de desfazer. Numa loja sem venda, uma function errada se corrige publicando de novo: rodar `functions --aplicar` republica toda function cujo código no ar difere do commit. |
| `login` | Sem comando de desfazer. O gancho nasce desligado, então nada deixa de funcionar. |
| `primeira-admin` | **Não tem desfazer pelo script.** Se a pessoa errada virou administradora, pare e leve ao dono. |
| `definir-dono` | Dona errada numa loja nova: o conserto é o `trocar-dono`, seguindo o procedimento de [Trocar a dona](#trocar-a-dona--trocar-dono-raro-só-com-o-pedido-escrito). |
| `trocar-dono` | **Sem comando de desfazer.** Voltar à dona antiga é outra troca, com o mesmo procedimento. |

## Lacunas conhecidas (27/11/2026)

- **A organização central não existe ainda** (01/12). Até lá, `criar-projeto` responde NÃO.
- **`endereco` (A11) não existe**, e `cadastro`, `marca` e `chave-do-plano` (A12 a A14) respondem
  NÃO de propósito. `functions` e o gancho de e-mail dependem do cadastro.
- **A confirmação do e-mail da lojista** não chega pelo serviço padrão do Supabase no modelo
  central ([armadilha](#a-confirmação-do-e-mail-da-lojista-não-chega-lacuna)).
- **O escopo do segredo dos workflows** só vale depois que o `medir-token-da-org.yml` der verde;
  se ele disser "o segredo é amplo demais", nenhuma loja entra no cadastro.
- **O roteiro inteiro ainda não foi ensaiado** (B6).
