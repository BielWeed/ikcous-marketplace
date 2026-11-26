# Ligar uma loja nova de assinante — a receita (nova-loja)

> Escrito em 26/11/2026 (plano nova-loja, tarefa C4), conferido no código de
> [`scripts/frota/nova-loja.mjs`](../../scripts/frota/nova-loja.mjs),
> [`scripts/frota/primeira-admin.mjs`](../../scripts/frota/primeira-admin.mjs) e
> [`scripts/frota/segredos-da-loja.mjs`](../../scripts/frota/segredos-da-loja.mjs). Os passos que
> ainda não estão no comando aparecem marcados como **ainda não automático** ou **em construção**.
> **Este roteiro ainda não foi ensaiado de ponta a ponta.** O ensaio com uma lojista de teste é a
> tarefa C5 do plano.

## Para quem é cada parte

| Quem lê | O que interessa |
|---|---|
| **O dono (Gabriel)** | [Parte 0](#parte-0--antes-de-começar-uma-vez-só) (uma vez só) e os passos marcados "**no terminal do dono**" |
| **A lojista** | Só a [Parte 1](#parte-1--as-3-telas-da-lojista): as 3 telas dela. Pode copiar o texto e mandar para ela |
| **O agente** | Tudo, principalmente a [Parte 2](#parte-2--os-passos-do-agente-comando-por-comando) em diante |

## Como a coisa funciona, em uma frase

A lojista cria uma conta grátis no Supabase (o serviço onde fica o banco de dados da loja) e
toca em "Autorizar a IKCOUS". A partir daí nós montamos a loja **dentro da conta dela**, por
comandos. A conta da IKCOUS **nunca** entra como membro da organização dela: usamos só a
autorização.

## O caminho inteiro, em ordem

| # | Quem | O quê | Situação hoje |
|---|---|---|---|
| 0 | Dono | Criar o OAuth App de produção (a "chave de entrada" da IKCOUS no Supabase) | uma vez só |
| 1 | Dono | `abrir`: gera o link de autorização da loja | comando pronto |
| 2 | Lojista | **Tela 1**: cria a conta e a organização no Supabase | — |
| 3 | Lojista | **Tela 2**: toca em Autorizar e manda o código | — |
| 4 | Dono | `receber`: cola o código | comando pronto |
| 5 | Agente | `criar-projeto`: cria o projeto da loja na conta dela | comando pronto |
| 6 | Agente | `banco`: instala o banco inteiro | comando pronto |
| 7 | Agente | `ficha`: confere a ficha da loja e gera o texto do cadastro | comando pronto |
| 8 | Agente | segredos da loja | **ainda não automático**: espere o C2 |
| 9 | Agente | cadastro na frota (`lojas.json`, canais, caderneta) | **em construção**: espere o B5/C2 |
| 10 | Agente | publicar as functions | **ainda não automático** (script avulso; depende do passo 9) |
| 11 | Agente | login da loja (endereços e gancho de e-mail desligado) | **ainda não automático** (script avulso) |
| 12 | Agente | domínio, marca e chave do plano | **ainda não automático**: espere o C2 |
| 13 | Lojista | **Tela 3, parte A**: se cadastra NA LOJA com o mesmo e-mail | — |
| 14 | Dono | `primeira-admin`: ela vira administradora | script pronto |
| 15 | Agente | `definir-dono`: ela vira a dona da loja | **em construção**: espere o C3 |
| 16 | Lojista | **Tela 3, parte B**: liga o Gmail e o Mercado Pago no painel | — |
| 17 | Agente | ligar o gancho de e-mail e subir o limite de e-mails | **lacuna conhecida** |
| 18 | Agente | `conferir`: a loja está pronta para vender? | **em construção**: espere o C3 |

**Hoje (26/11/2026) o caminho só anda sozinho até o passo 7.** Do 8 em diante, cada passo diz o
que existe e o que falta. Os roteiros manuais das lojas antigas **não servem** para a loja nova:
eles usam token fixo no repositório, chave de serviço ou o painel do projeto, e a IKCOUS não tem
nada disso na conta da lojista (ver [Lacunas conhecidas](#lacunas-conhecidas-26112026)).

**Antes da 1ª loja REAL:** o passo `trocar-dono` tem de existir (decisão do sócio). Até lá, só
loja de teste.

## Regras que valem em todos os passos

- **Segredo nunca vai para o chat.** O client secret do OAuth App, o código que a lojista manda,
  a senha do banco e o e-mail da lojista se digitam **só no terminal do dono**, quando o comando
  pede. Nenhum comando aceita esses valores como argumento, porque a linha de comando fica no
  histórico do PowerShell. Neste documento, todo valor que é segredo aparece como `<cole-aqui>`.
- **Nunca mande print do terminal.** Quando o comando pede o client secret, o código ou o e-mail, o
  que você cola **fica visível na tela** (o comando não esconde). Um print levaria o segredo junto.
  Se precisar mostrar um erro, copie só a linha da mensagem.
- **Sem `--aplicar`, nada acontece de verdade.** O comando só lê e diz o que faria. Esse é o
  **ensaio**. Rode sempre o ensaio antes, e depois o mesmo comando com `--aplicar`.
- **No ENSAIO, o veredito não é SIM.** Sem `--aplicar`, INCERTO (no `nova-loja.mjs`) ou NÃO (no
  `functions-da-loja.mjs`, no `login-da-loja-nova.mjs` e no `primeira-admin.mjs`) é o esperado. O
  que vale no ensaio é a frase que começa com `ENSAIO` (ou o plano que o script imprime): ela diz o
  que o comando faria. A regra abaixo vale para a rodada com `--aplicar`.
- **Todo passo termina com SIM, NÃO ou INCERTO.**
  - **SIM**: deu certo e foi conferido. Siga para o próximo passo.
  - **NÃO**: não fez, ou recusou de propósito. A mensagem diz o motivo. Não insista sem ler.
  - **INCERTO**: o comando não conseguiu confirmar o que aconteceu (internet, demora, resposta
    estranha). **INCERTO nunca é SIM.** Quase sempre se resolve rodando o mesmo comando de novo,
    porque os passos retomam de onde pararam.
- **O número que o comando devolve** fica em `$LASTEXITCODE`. No `nova-loja.mjs` e no
  `primeira-admin.mjs`: `0` = SIM, `1` = NÃO, `2` = INCERTO. Nos scripts avulsos
  `functions-da-loja.mjs` e `login-da-loja-nova.mjs` é diferente: `0` = SIM, `1` = NÃO,
  `2` = uso errado, `3` = INCERTO. Exceção: se o `login-da-loja-nova.mjs` quebrar com um erro
  inesperado (a mensagem é `erro inesperado (detalhes não impressos)`), ele sai com `1`, não com
  `3`. Trate como INCERTO: rode de novo sem `--aplicar`.
- **Troque os marcadores pelo valor, sem os sinais `<` e `>`.** Onde está `<slug>`, escreva por
  exemplo `minhaloja`; onde está `<ref>`, as 20 letras do projeto. No PowerShell 5.1, colar o
  marcador como está (`<slug>`) dá erro, porque `<` é um símbolo do próprio PowerShell.
- **PowerShell 5.1**: nada de `&&`. Um comando por vez.
- **O apelido da loja (`<slug>`)** usa minúsculas, dígitos e hífen. Começa com letra, tem **até 24
  caracteres** e **não termina em hífen**. O comando aceita até 40, mas o cadastro na frota só
  aceita até 24 (o nome do segredo `SUPABASE_ACCESS_TOKEN_<SLUG>` tem esse teto). Escolha uma
  vez e não troque: é a chave do cofre, do estado e do cadastro.

### Abrir o terminal no lugar certo

1. No Windows, abra o menu Iniciar, digite **Windows PowerShell** e clique nele. É o PowerShell
   azul, versão 5.1; o "PowerShell 7" (preto) não é o que este roteiro usa.
   - **O que aparece:** uma janela com uma linha que termina em `>`.
2. Vá até a pasta do repositório. Deixe o caminho entre aspas duplas, para um espaço no nome da
   pasta não quebrar o comando:

   ```powershell
   Set-Location "<pasta do repositório ikcous-marketplace no seu PC>"
   ```

   - **Como saber que deu certo:** `Test-Path scripts/frota/nova-loja.mjs` responde `True`.
   - **Se responder `False`:** a pasta está errada, ou o código ainda não tem o comando. Pare e me
     chame.
3. **O checkout tem de ser o da release aprovada.** "Checkout" é a versão do código que está
   aberta nessa pasta agora. "Release aprovada" é o commit que passou no CI e na revisão e está
   publicado (o topo da branch `claude/app-major-upgrade-wmc8x2` no GitHub). Isso importa porque o
   passo `banco` instala as migrations **que estão na pasta**, e o `functions-da-loja.mjs` publica
   o código da pasta: versão errada = loja montada com código errado. **Quem confere isso é o
   agente**, antes de você rodar qualquer passo. Se ele não disse "pode rodar nesta pasta", não
   rode.

### Onde o comando guarda as coisas (no PC do dono, fora do repositório)

| Pasta | O que tem | Segredo? |
|---|---|---|
| `$env:LOCALAPPDATA\ikcous\frota\nova-loja\<slug>.json` | o andamento: qual passo deu SIM, o ref do projeto | não |
| `$env:LOCALAPPDATA\ikcous\frota\acesso\<slug>.dpapi` | o client secret e a autorização da lojista, cifrados pelo Windows | **sim** |
| `$env:LOCALAPPDATA\ikcous\frota\banco\<slug>.dpapi` | a senha do banco da loja, cifrada pelo Windows | **sim** |

Os arquivos `.dpapi` só abrem com a mesma conta do Windows, neste PC. Não copie, não mande, não
abra.

---

## Parte 0 — Antes de começar (uma vez só)

### O OAuth App de produção (o dono faz)

**O que é:** o "cadastro" da IKCOUS dentro do Supabase. É ele que faz aparecer, para a lojista, a
tela "Authorize IKCOUS". Cria-se **uma vez** e vale para todas as lojas.

1. No seu Chrome, abra `https://supabase.com` e entre na conta da IKCOUS.
   - **O que aparece:** a lista das suas organizações.
2. Clique na organização **"ikcous - BDfree"**.
   - **O que aparece:** os projetos dessa organização.
3. No menu da esquerda, clique em **Organization settings** (o ícone de engrenagem). Depois, em
   **OAuth Apps**.
   - **O que aparece:** a lista de OAuth Apps, com o botão **Publish OAuth app**. Pode já ter o
     app da prova de 26/11 ("IKCOUS Provisionador (prova)"). **Não mexa nele.**
4. Clique em **Publish OAuth app** e preencha:
   - **Nome:** `IKCOUS`
   - **Redirect URLs (endereços de volta)**, os dois:
     - `https://<endereço do app de gestão>/autorizado`
     - `http://localhost:8787/callback`
   - **Escopos (o que a IKCOUS pode fazer na conta da lojista):**

     | Categoria | Marcar |
     |---|---|
     | Projects | Read e Write |
     | Database | Read e Write |
     | Edge Functions | Read e Write |
     | Secrets | Read e Write |
     | Auth | Read e Write |
     | Organizations | só Read |
     | Domains, Environment, Rest, Storage | **nada** |

   - Se o formulário pedir um site ou um ícone, use o endereço do app de gestão. O resto fica como
     está.
5. Clique em **Publish** (ou no botão de confirmar do formulário).
   - **O que aparece:** o **Client ID** e o **Client Secret** do app.
6. **O Client ID** não é segredo: pode me mandar no chat.
7. **O Client Secret é segredo.** Não mande no chat, nem em print. Guarde no seu gerenciador de
   senhas. Ele vai ser **digitado por você no terminal**, no passo `abrir` de cada loja.

**Como saber que deu certo:** o app "IKCOUS" aparece na lista de OAuth Apps, com os escopos acima.

**Se aparecer diferente:** se o Supabase mudou o nome de algum botão ou categoria, pare e me
mande um print **da tela sem o Client Secret**.

**Cuidado:** não gere um Client Secret novo sem falar comigo. O cofre de cada loja guarda o secret
da época em que ela foi aberta, e a renovação da autorização usa esse valor. Um secret novo pode
cortar o acesso às lojas já abertas.

**Uma conta de "lojista de teste"** (com outro e-mail) também é preparada uma vez, para o ensaio
(C5). O motivo é o mesmo limite de 2 projetos grátis por pessoa, explicado na Tela 1.

**Dependência ainda não confirmada:** a página `/autorizado` do app de gestão (a que mostra o
código com o botão Copiar). Se ela ainda não estiver no ar, a Tela 2 tem um caminho alternativo:
copiar o endereço inteiro da barra do navegador.

---

## Parte 1 — As 3 telas da lojista

> Esta parte pode ser copiada e mandada para a lojista do jeito que está.

### Antes de tudo: de quem é a loja

1. **A conta do Supabase é criada com o e-mail de quem é DONA do negócio**, a pessoa que recebe o
   dinheiro das vendas. Se outra pessoa estiver configurando (um funcionário, um sobrinho que
   entende de computador), ela usa **o e-mail da dona**, não o dela.
2. **A dona se cadastra na loja com ESSE MESMO e-mail.** Essa conta vira a dona da loja: só ela
   troca a conta do Mercado Pago e o Gmail da loja, e só ela dá ou tira o cargo de administrador.
3. **Funcionário que vira administrador** cuida de pedidos e produtos, mas **não** muda para onde
   vai o dinheiro.
4. **Trocar de dona** (venda da loja ou erro no cadastro) é um pedido à IKCOUS, **nunca** pelo
   painel.

### Tela 1 — Criar a conta no Supabase

1. Abra `https://supabase.com` e toque em **Start your project** (ou **Sign up**).
2. Crie a conta com o **e-mail da dona** e uma senha. A senha é só sua: nunca mande para a
   IKCOUS.
   - **O que aparece:** um aviso pedindo para confirmar o e-mail.
3. Abra o e-mail que o Supabase mandou e toque no link de confirmação. Se não achar, olhe no Spam.
4. Entre na conta. O Supabase pede para criar uma **organização**:
   - **Nome:** o nome da sua loja.
   - **Tipo:** Personal (pessoal).
   - **Plano:** **Free** (grátis). Não coloque cartão.
5. Toque em **Create organization**.
6. **Não crie nenhum projeto.** Se o Supabase oferecer "criar projeto", feche ou pule. Quem cria o
   projeto da loja é a IKCOUS, pela autorização.
7. Mande para a IKCOUS **o endereço que está na barra do navegador** nessa hora. Ele tem o
   formato `https://supabase.com/dashboard/org/...`: o pedaço depois de `org/` é o nome
   técnico da sua organização.

**Por que não criar projeto:** cada pessoa só pode ter **2 projetos grátis ativos**, somando todas
as organizações em que é dona ou administradora. Projeto pausado não conta. Se você já tem 2,
pause um antes, ou crie outra conta no Supabase, com outro e-mail, que também tem de ser um
e-mail da dona da loja.

**A conta da IKCOUS nunca vira membro da sua organização.** Se alguém pedir para você convidar a
IKCOUS como membro, não convide: isso gastaria o limite de projetos da IKCOUS e não é o caminho.

**Como saber que deu certo:** você entra no Supabase e vê a sua organização, sem nenhum projeto.

**Se aparecer diferente:** mande um print para a IKCOUS (sem senha na tela).

### Tela 2 — Tocar em Autorizar

1. A IKCOUS manda para você um link longo, que começa com
   `https://api.supabase.com/v1/oauth/authorize`. Abra no navegador onde você está logada no
   Supabase.
   - **O que aparece:** a tela **"Authorize IKCOUS"**, com a lista do que a IKCOUS vai poder fazer
     e a **organização** que vai ser liberada.
2. **Confira a organização marcada.** Ela tem de ser **a sua** (a da loja). O Supabase abre com a
   primeira da lista marcada, que pode não ser a certa. Troque se precisar.
3. Toque em **Authorize**.
   - **O que aparece:** uma página da IKCOUS com um **código** e o botão **Copiar**.
4. Toque em **Copiar** e mande o código para a IKCOUS, pelo mesmo canal de sempre. Mande logo: o
   código vale por pouco tempo.

**Como saber que deu certo:** apareceu o código com o botão Copiar.

**Se aparecer diferente:**
- **Página em branco ou com erro, mas a barra do navegador tem `code=`**: copie o **endereço
  inteiro** da barra do navegador e mande. Ele também serve.
- **O Supabase recusou ou deu erro antes de Autorizar**: mande um print. A IKCOUS gera um link
  novo; o antigo deixa de valer.

### Tela 3 — Dentro da loja e do painel

**Parte A — se cadastrar na loja (quando a IKCOUS avisar que a loja está no ar):**

1. Abra o endereço da sua loja, que a IKCOUS vai mandar.
2. Toque em **Criar conta** e use **o mesmo e-mail da conta do Supabase** (o e-mail da dona).
3. Confirme o e-mail pelo link que chegar. Olhe no Spam também. **Não peça para reenviar várias
   vezes:** neste começo a loja só consegue mandar 2 e-mails por hora. Se não chegou em 15 minutos,
   avise a IKCOUS.
4. Entre na loja uma vez e avise a IKCOUS: "confirmei".

**Parte B — no painel (quando a IKCOUS avisar que você já é a administradora):**

1. **Saia da loja e entre de novo.** Sem isso, o painel não aparece.
2. **Gmail da loja:** Painel > **Ajustes** > **Minha loja** > **E-mail da loja**. Siga o passo a
   passo da própria tela: um Gmail só da loja, verificação em duas etapas, senha de app, colar,
   **Salvar** e **Enviar e-mail de teste**. O e-mail de teste aparece em **Enviados** (o Gmail
   não mostra na Caixa de Entrada o e-mail que a conta manda para ela mesma).
3. **Mercado Pago:** Painel > **Ajustes** > **Pagamentos** > **Mercado Pago** > **Avançado: chaves
   do Mercado Pago** > **Suas chaves**. Siga o guia da tela: as chaves do seu Mercado Pago, o
   endereço dos avisos e a senha dos avisos, **Salvar** e **Testar conexão**.
4. Avise a IKCOUS que terminou.

**Como saber que deu certo:** o e-mail de teste aparece em Enviados, e o teste do Mercado Pago diz
que a conexão está certa.

**Se aparecer diferente:** a frase "esta loja ainda não está preparada" ou "este recurso ainda não
está disponível" é do nosso lado, não do seu. Mande um print para a IKCOUS.

---

## Parte 2 — Os passos do agente, comando por comando

Tudo na pasta do repositório, numa janela de Windows PowerShell 5.1 aberta como em
[Abrir o terminal no lugar certo](#abrir-o-terminal-no-lugar-certo), no checkout da release
aprovada. Antes de cada passo, rode o ensaio (sem `--aplicar`) e leia o que ele diria.

### Passo 1 — `abrir` (no terminal do dono)

**O que faz:** lê o Client Secret pela entrada, guarda no cofre da loja a autorização pendente
(com a proteção PKCE, que amarra o código à máquina que pediu) e imprime o link e o texto para a
lojista. Rodar de novo gera outro link, e o anterior deixa de valer.

Ensaio:

```powershell
node scripts/frota/nova-loja.mjs abrir --loja <slug> --client-id <client id do OAuth App> --redirect "https://<endereço do app de gestão>/autorizado"
```

De verdade:

```powershell
node scripts/frota/nova-loja.mjs abrir --loja <slug> --client-id <client id do OAuth App> --redirect "https://<endereço do app de gestão>/autorizado" --aplicar
```

- **O que aparece:** `Cole o client_secret do OAuth App da IKCOUS e tecle Enter:`. O dono cola
  `<cole-aqui>` e tecla Enter. Depois aparecem o link e o texto "Mande para a lojista, exatamente
  nesta ordem:".
- **SIM:** mande o link para a lojista (Telas 1 e 2).
- **NÃO:**
  - `abrir precisa de --client-id e --redirect`: faltou um dos dois.
  - `A entrada veio vazia`: o Enter foi antes de colar. Rode de novo.
  - `Outro comando da loja <slug> está rodando (trava ...)`: veja
    [a trava órfã](#ctrl-c-no-meio-de-uma-espera-deixa-uma-trava-órfã).
- **INCERTO:** o cofre não confirmou a gravação. Rode `abrir --aplicar` de novo e mande o link
  **novo**.

### Passo 2 — `receber` (no terminal do dono)

**O que faz:** lê o código que a lojista mandou, troca pela autorização e guarda a parte
duradoura (o refresh) no cofre. A parte de uso imediato (o access token, que vale cerca de 24 h)
fica só na memória e nunca é gravada.

```powershell
node scripts/frota/nova-loja.mjs receber --loja <slug> --aplicar
```

- **O que aparece:** `Cole o código que a lojista mandou (ou o endereço inteiro) e tecle Enter:`.
  O dono cola `<cole-aqui>`.
- **SIM:** `autorização recebida`. Siga para o passo 3.
- **NÃO:**
  - `não tem autorização aberta: rode abrir --aplicar antes`: falta o passo 1.
  - Código recusado: o código venceu, foi usado duas vezes ou veio de um link antigo. Rode `abrir`
    de novo e mande o link novo.
- **INCERTO:** a resposta do Supabase não veio. **Não** cole o mesmo código de novo: o código é de
  uso único. Rode `abrir --aplicar` e peça uma autorização nova.

### Passo 3 — `criar-projeto`

**O que faz:**
1. Confere que a autorização cobre **exatamente** a organização informada.
2. Procura um projeto chamado `ikcous-<slug>` (um pedido anterior pode ter criado e perdido a
   resposta).
3. Se não achar, cria o projeto em `sa-east-1` (São Paulo). A senha do banco é gerada forte e
   guardada **só** no cofre, antes do pedido.
4. Espera o projeto ficar `ACTIVE_HEALTHY` (pronto), consultando de 10 em 10 segundos por até
   5 minutos.

```powershell
node scripts/frota/nova-loja.mjs criar-projeto --loja <slug> --org <org da lojista>
```

```powershell
node scripts/frota/nova-loja.mjs criar-projeto --loja <slug> --org <org da lojista> --aplicar
```

`<org da lojista>` é o pedaço depois de `org/` no endereço que ela mandou na Tela 1.

- **SIM:** `projeto <ref> pronto (ACTIVE_HEALTHY) em sa-east-1`. Anote o `<ref>` (20 letras
  minúsculas): os scripts avulsos pedem esse valor.
- **NÃO:**
  - `a autorização tem de cobrir exatamente a organização <org>, e cobre ...`: ou o `--org` está
    errado, ou a lojista autorizou a organização errada. A mensagem mostra qual organização a
    autorização cobre. Se for a da lojista, rode de novo com esse nome. Se não for, peça uma
    autorização nova (passos 1 e 2).
  - `a conta da lojista já tem 2 projetos grátis ATIVOS`: a lojista pausa ou apaga um projeto
    dela, ou cria outra conta no Supabase, com outro e-mail, que também tem de ser um e-mail da
    dona. Com conta nova, a autorização também é nova (passos 1 e 2). Depois, rode de novo.
  - `HTTP 402`: fatura atrasada na organização dela. Ela confere Billing no painel do Supabase.
  - `INIT_FAILED`, `REMOVED` e outros estados sem volta: o comando **não** apaga nem recria
    sozinho. O que fazer com o projeto é decisão do dono, com a lojista olhando o painel dela.
  - `o estado desta loja diz organização X, e foi pedida Y`: o `--org` mudou no meio. Use o mesmo
    da primeira vez.
  - `há N projetos chamados ikcous-<slug>`: pare e leve ao dono. O comando não escolhe.
- **INCERTO:**
  - `não ficou ACTIVE_HEALTHY em 5 min`: normal num dia lento. Espere uns minutos e rode o mesmo
    comando. A retomada só confere o status, **não cria outro projeto**.
  - `O projeto PODE ter sido criado`: rode de novo. A retomada procura pelo nome antes de criar, e
    a senha no cofre é a mesma.

### Passo 4 — `banco`

**O que faz:** instala o banco inteiro, uma migration por pedido (são mais de 276). Cada migration
vai junto com o seu registro na lista do que já foi aplicado (o "ledger"), na mesma transação: ou
os dois entram, ou nenhum. Antes da primeira, aplica as permissões padrão que projeto novo do
Supabase não traz mais. Só diz SIM depois de reler o banco e conferir que a fila **inteira** está
no ledger e a instalação está marcada como concluída.

```powershell
node scripts/frota/nova-loja.mjs banco --loja <slug>
```

O ensaio diz quantas migrations a fila deste checkout tem. Confira que o checkout é o da release
aprovada antes de seguir.

```powershell
node scripts/frota/nova-loja.mjs banco --loja <slug> --aplicar
```

- **SIM:** `Conferido: as N migrations da fila estão no ledger e a instalação está marcada como
  concluída.`
- **NÃO:**
  - `rode criar-projeto --aplicar até dar SIM antes de banco`: falta o passo 3.
  - `FALHOU em <arquivo> (código ...)`: o banco recusou aquela migration, e nada dela ficou
    gravado. As anteriores estão no ledger. Leve o arquivo e o código ao programador antes de
    rodar de novo.
  - `RECUSADO: ... loja já instalada`: o banco já tem ledger sem a marca de instalação em curso.
    Esse instalador não mexe em loja que já existe. Pare.
  - `FALHOU ao conferir os privilégios padrão ... rodar de novo é seguro`: nenhuma migration foi
    enviada, a conferência é só leitura e o ajuste é idempotente (repetir não muda nada). Rode o
    mesmo comando de novo. Se repetir, leve a mensagem ao programador.
- **INCERTO:**
  - `ESTADO DESCONHECIDO ... a resposta não veio`: a migration pode ter entrado ou não. **Rode o
    mesmo comando de novo**: ele relê o ledger e continua do ponto certo, sem repetir o que entrou.
  - **Erro 429 (pedidos demais):** ver [as armadilhas](#a-instalação-do-banco-bate-no-limite-de-pedidos-por-minuto).
  - `o projeto não está ACTIVE_HEALTHY agora`: rode `criar-projeto --aplicar` e depois `banco`
    de novo.

### Passo 5 — `ficha`

**O que faz:** só leitura. Confere que a ficha da loja (`public.store_config`, linha `id = 1`)
existe e foi criada pela migration certa. Depois **gera, sem executar,** o texto do cadastro: a
linha da caderneta da frota (`frota_lojas`) e a entrada de `scripts/frota/lojas.json`.

```powershell
node scripts/frota/nova-loja.mjs ficha --loja <slug> --aplicar
```

Use `--nome "<Apelido>"` se o apelido da loja não for o próprio `<slug>` (até 30 caracteres,
começando por letra).

- **SIM:** a saída traz o SQL da caderneta e a entrada de `lojas.json`. **Guarde as duas** para o
  passo 9 (cadastro).
- **NÃO:**
  - `rode banco --aplicar até dar SIM antes da ficha`: falta o passo 4.
  - `a ficha (public.store_config id = 1) não existe`: a migration `20261540000000` não rodou
    nesse banco. Pare. Não crie a linha à mão.
  - `lojas.json já tem uma loja <slug> com outros valores`: o apelido já está em uso. Pare.
- **INCERTO:**
  - `a ficha id = 1 existe, mas sem a marca da migration`: a ficha não nasceu pelo caminho
    esperado. Confira antes de cadastrar.
  - `não achei UMA chave publishable`: rode de novo. Se repetir, leve ao programador.

### Passo 14 — `primeira-admin` (no terminal do dono)

Este script **já existe** e roda sozinho (fora do comando `nova-loja.mjs`). Ele vem **depois** que
a lojista se cadastrou na loja e confirmou o e-mail (Tela 3, parte A), e por isso depende dos
passos 8 a 12.

**O que faz:** transforma a conta da lojista na **primeira** administradora da loja. Ele só age se:
- existe exatamente 1 conta com esse e-mail na loja;
- o e-mail está confirmado;
- a loja tem 0 administradoras.

Tudo vai numa transação só, que termina conferindo "1 conta, 1 linha mudada, 1 administradora".
Se a mesma pessoa já é a administradora única, ele diz SIM sem gravar nada.

**O e-mail entra só pela entrada**, nunca na linha de comando. O agente não precisa saber o e-mail.
Primeiro, na mesma janela, faça o PowerShell mandar acentos direito para o Node (ver
[a armadilha do acento](#e-mail-com-acento-no-powershell-51)):

```powershell
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
```

Ensaio (só lê):

```powershell
Read-Host "e-mail" | node scripts/frota/primeira-admin.mjs --projeto <ref> --loja <slug>
```

De verdade:

```powershell
Read-Host "e-mail" | node scripts/frota/primeira-admin.mjs --projeto <ref> --loja <slug> --aplicar
```

- **O que aparece:** `e-mail:`. O dono digita o e-mail da lojista e tecla Enter. A saída mostra
  `e-mail recebido (N caracteres)`. **Confira que N é o número de caracteres do e-mail.**
- **A última linha** é sempre `VEREDITO: SIM|NÃO|INCERTO — ...`.
- **SIM:** `ela agora é a administradora da loja`. Diga à lojista para **sair e entrar de novo**.
- **NÃO:**
  - No ensaio, `ela ainda não é administradora; ... rode o mesmo comando com --aplicar` é o
    esperado: agora rode com `--aplicar`.
  - `nenhuma conta com esse e-mail nesta loja`: ela ainda não se cadastrou, o e-mail foi digitado
    diferente, ou o `--projeto` não é o da loja. Se o e-mail tem acento ou ç, veja a armadilha do
    acento.
  - `ela ainda não confirmou o e-mail`: peça que ela abra o link de confirmação e entre na loja uma
    vez. Depois, rode de novo.
  - `a loja já tem outra administradora`: este script só cria a **primeira**. Pare e leve ao
    dono.
  - `mais de uma conta`, `sem perfil`, `cargo inesperado`, `as duas fontes do cargo discordam`:
    pare e leve ao programador.
  - `o banco recusou a transação (SQLSTATE ...)`: nada foi gravado. Não improvise outro caminho.
  - `outra rodada deste comando segurava a trava`: espere e rode de novo.
- **INCERTO:** rode de novo **sem** `--aplicar` para ler o estado. Repetir é seguro: se ela já
  virou administradora, o script diz SIM sem gravar.

---

## Parte 3 — Ainda não automático

Estes passos ainda não estão no comando `nova-loja.mjs`. Os passos `segredos`, `functions`,
`login`, `marca` e `chave-do-plano` entram na tarefa C2 do plano. `primeira-admin`,
`definir-dono` e `conferir` entram na C3.

### Passo 8 — Segredos da loja — ainda não automático

**O que precisa ser feito:**
- a chave que cifra as credenciais do Mercado Pago e do Gmail (`MP_CHAVES_ENCRYPTION_KEY`);
- o segredo da reconciliação de pagamentos, nas functions e no Vault (o cofre do banco), com o
  mesmo valor, mais o endereço da function `reconciliar-pagamentos`;
- o par de chaves das notificações (VAPID), com a pública também na ficha da loja.

**O que existe:** o script
[`scripts/frota/segredos-da-loja.mjs`](../../scripts/frota/segredos-da-loja.mjs). Ele nunca
substitui o que já existe e nunca imprime valor.

**Por que ainda não dá para usar numa loja nova:** rodado sozinho, ele pede o token na variável
`SUPABASE_ACCESS_TOKEN`. O token da lojista nunca sai do cofre (de propósito), então não há
caminho seguro para entregar esse token ao script avulso. Ele foi feito para ser chamado pelo
`nova-loja.mjs`, que ainda não tem o passo `segredos`. **Espere o C2.** Não copie o token para
uma variável à mão.

Para referência, o uso dele é este:

```powershell
node scripts/frota/segredos-da-loja.mjs --projeto <ref>
```

A última linha é `VEREDITO-SEGREDOS-DA-LOJA projeto=<ref> veredito=SIM|NAO|INCERTO aplicar=...`.

**Sem este passo:** o Gmail e o Mercado Pago no painel ficam "indisponível", e o PIX cujo aviso se
perdeu nunca vira pedido pago.

### Passo 9 — Cadastro na frota — em construção

O script `cadastro-da-loja.mjs` **ainda não existe** (tarefa B5; o passo entra no comando no C2).
**Não dá para usar numa loja nova o roteiro manual** (passos 1 a 3 da seção "Loja assinante nova"
de [producao-unica-fonte.md](producao-unica-fonte.md)). Ele foi escrito para loja com **token fixo
no repositório**:
- o passo 2 de lá manda o dono gravar o segredo `SUPABASE_ACCESS_TOKEN_<LOJA>` no repositório e
  termina com uma conferência pelo `conferir-banco-da-loja.yml`, que usa esse segredo;
- a entrada de `lojas.json` aponta `segredoDoToken` para esse nome, e o
  `lojas-nos-workflows.cjs --escrever` liga os workflows a ele.

A loja nova não tem token fixo: só a autorização OAuth da lojista, no cofre do PC do dono. Então
o segredo ficaria vazio e os workflows da loja não funcionariam. **Espere o B5/C2.** Guarde o SQL
da caderneta e a entrada de `lojas.json` que o passo `ficha` imprimiu; o cadastro vai usá-los.

### Passo 10 — Publicar as functions — ainda não automático (script avulso)

**O que existe:** `scripts/frota/functions-da-loja.mjs`. Ele está na branch
`claude/nova-loja-functions` e ainda não foi juntado nesta base.

**O que faz:** publica uma por uma as functions do canal da loja (13 numa loja assinante), cada uma
com o `verify_jwt` do `supabase/config.toml`, e confere cada uma antes da próxima. Pula a que já
está no ar igual. Usa o token da lojista direto do cofre.

**Antes de rodar:**
- o passo 9 (a loja tem de estar em `lojas.json` e em `canais-de-backend.json`). Como o passo 9
  espera o B5/C2, **na prática este passo também espera**;
- o checkout tem de estar **exatamente** no topo de `origin/claude/app-major-upgrade-wmc8x2`, o
  commit aprovado. Fora dele, o script diz NÃO antes de qualquer pedido.

```powershell
node scripts/frota/functions-da-loja.mjs --projeto <ref> --canal <slug>
```

```powershell
node scripts/frota/functions-da-loja.mjs --projeto <ref> --canal <slug> --aplicar
```

- **SIM (0):** todas no ar, ativas, com o `verify_jwt` certo.
- **NÃO (1):** falta alguma, há conflito, ou as fontes divergem. A mensagem diz qual.
- **Uso errado (2):** argumento faltando ou inválido.
- **INCERTO (3):** uma publicação pode ter acontecido sem confirmação. Rode o ensaio para ler o
  estado e depois rode de novo: o que já subiu igual é pulado.

**Depois que deu SIM: a loja NÃO entra em `functionsSoPeloWorkflow`.** O comentário dessa lista
em `scripts/frota/canais-de-backend.json` diz que a loja nova entra nela depois que as functions
sobem, e que daí em diante elas só sobem pelo `publicar-functions.yml`. Numa loja só-OAuth isso
quebraria a loja: o workflow só usa segredos fixos do repositório (`publicar-functions.yml`, linhas
136 e 211-213) e não alcança a loja. Ao mesmo tempo, o `functions-da-loja.mjs` passaria a recusá-la.
As functions de dinheiro ficariam velhas, sem conserto. **Até existir uma release de functions e
migrations para loja só-OAuth, a loja fica fora dessa lista** (ver
[Lacunas conhecidas](#lacunas-conhecidas-26112026)).

### Passo 11 — Login da loja — ainda não automático (script avulso)

**O que existe:** `scripts/frota/login-da-loja-nova.mjs`. Ele está na branch
`claude/nova-loja-login` e ainda não foi juntado nesta base.

**O que faz:**
- acerta os endereços do login (`site_url` e a lista de endereços de volta), para o link do e-mail
  de confirmação não cair numa página morta;
- prepara o gancho de e-mail (Send Email Hook) **desligado**, com o segredo gravado nas duas
  pontas.

Não liga o Google, não mexe em SMTP. O limite de 30 e-mails por hora só é gravado quando a loja
tem remetente próprio (Gmail ligado no gancho, ou SMTP).

```powershell
node scripts/frota/login-da-loja-nova.mjs --projeto <ref> --loja <slug> --dominio "https://<domínio da loja>"
```

```powershell
node scripts/frota/login-da-loja-nova.mjs --projeto <ref> --loja <slug> --dominio "https://<domínio da loja>" --aplicar
```

- **SIM (0):** tudo conferido por releitura.
- **NÃO (1):** falta algo, ou há "meia configuração" do gancho. Nesse caso o script não grava
  nada, e quem decide a recuperação é uma pessoa.
- **Uso errado (2):** argumento faltando ou inválido.
- **INCERTO (3):** rode de novo **sem** `--aplicar` antes de qualquer outra coisa.

**Por que o gancho nasce desligado:** ligado antes do Gmail, todo e-mail de login falharia,
inclusive a confirmação da conta da lojista.

### Passo 12 — Domínio, marca e chave do plano — ainda não automático

**Não dá para usar numa loja nova o roteiro manual** dos passos 6 e 6A da seção "Loja assinante
nova" de [producao-unica-fonte.md](producao-unica-fonte.md). Cada pedaço dele pede um acesso que a
IKCOUS não tem na conta da lojista:
- **chave do plano:** vai pelo `instalar-chave-da-loja.yml`, que usa o segredo fixo
  `SUPABASE_ACCESS_TOKEN_<LOJA>` do repositório (`instalar-chave-da-loja.yml`, linhas 174-175). A
  loja nova não tem esse segredo;
- **domínio da ficha (`dominio_publico`):** o roteiro manda gravar pelo SQL Editor do projeto da
  loja. O projeto é da lojista, e a IKCOUS não entra no painel dela;
- **marca (passo 6A):** o `scripts/identidade-bootstrap.mjs` exige a chave de serviço da loja
  (`SUPABASE_SERVICE_ROLE_KEY`, linha 471), que a IKCOUS não tem.

**Espere o C2** (passos `marca` e `chave-do-plano` no comando). Sem a marca, a vitrine mostra "Esta
loja está em manutenção" e a lojista não consegue se cadastrar (Tela 3, parte A).

### Passo 15 — `definir-dono` — em construção

**A regra, decidida pelo sócio:**
- a **única** administradora da loja vira a dona automaticamente, lida do banco, **sem pedir
  e-mail**;
- com um dono diferente já cadastrado, ou com 2 ou mais administradoras, o passo dá **NÃO** e não
  escolhe ninguém;
- ele só roda em loja aberta pelo `nova-loja.mjs`.

**Enquanto não existe, não há caminho numa loja nova. Espere o C3.** A receita da seção 3.3 de
[definir-o-dono-da-loja.md](definir-o-dono-da-loja.md) é feita no SQL Editor do projeto da loja, e
o projeto é da lojista: a IKCOUS não entra no painel dela. Sem dono cadastrado, qualquer
administradora troca as chaves do Mercado Pago e do Gmail, e ninguém consegue dar o cargo de
administrador.

### Passo 17 — Ligar o gancho de e-mail e subir o limite — lacuna conhecida

**Depois que a lojista ligou o Gmail** (Tela 3, parte B), o gancho de e-mail tem de ser ligado
(`acao=ativar`). Depois disso, **rode `login-da-loja-nova.mjs --aplicar` de novo**: com o gancho
ligado a loja tem remetente próprio, e só então o limite de e-mails sobe para 30 por hora.

**A lacuna:** hoje quem liga o gancho é o workflow `ativar-email-do-login.yml`, e ele **não alcança
loja nova**. Ele só aceita lojas de `scripts/frota/lojas.json` que têm um token fixo guardado como
segredo do repositório. A loja nova tem só a autorização OAuth da lojista, que vive no cofre do
PC do dono. Enquanto não houver outro caminho, a loja nova fica com o gancho desligado: o e-mail de
login sai pelo e-mail padrão do Supabase (2 por hora, só para o time do projeto) e o cliente comum
**não recebe** o e-mail de confirmação.

### Passo 18 — `conferir` — em construção

Vai responder SIM, NÃO ou INCERTO para "a loja pode vender?". **Enquanto não existe, a
conferência à mão não fecha numa loja nova. Espere o C3.** As conferências que os outros roteiros
usam pedem acessos que a IKCOUS não tem na conta da lojista:
- **reconciliação:** o passo 4 da seção "Loja assinante nova" de
  [producao-unica-fonte.md](producao-unica-fonte.md) lê `saude_da_loja()` pelo SQL Editor do
  projeto, que é da lojista. Além disso, a leitura só faz sentido depois dos segredos (passo 8, que
  espera o C2);
- **dono:** a consulta 88c ([definir-o-dono-da-loja.md](definir-o-dono-da-loja.md), seção 3.4) roda
  pelo SQL Editor ou pelos workflows da frota, que usam o segredo fixo da loja;
- **login:** `login-da-loja-nova.mjs` sem `--aplicar` é o único que já funciona (usa o cofre). Ele
  sozinho não diz que a loja pode vender.

O ensaio de ponta a ponta (C5) inclui um PIX real de R$ 1.

---

## Publicar quando há loja OAuth: a sessão

> Conferido no código de [`scripts/frota/publicar-release.mjs`](../../scripts/frota/publicar-release.mjs)
> (`--sessao` e `--faxina`) e [`scripts/frota/ponte-oauth.mjs`](../../scripts/frota/ponte-oauth.mjs)
> em 26/11/2026. **Ainda não foi ensaiada com uma loja de verdade** (é a T12 do plano da ponte A).

**Por que existe.** A loja OAuth não tem segredo fixo no GitHub. Os workflows da frota
(`gh workflow run ...`) só conseguem mexer nela enquanto o segredo `SUPABASE_ACCESS_TOKEN_<SLUG>`
dela estiver lá. A **sessão** é um comando que fica aberto numa janela: ao abrir, grava esse
segredo; enquanto está aberta, você ensaia e publica; ao fechar, apaga o segredo do GitHub. Funciona
como o cartão de um quarto de hotel: vale enquanto você está hospedado, e o check-out é o fechar.

**Quem roda:** o dono, no Windows PowerShell 5.1, na pasta da release que o agente indicou (veja
[Abrir o terminal no lugar certo](#abrir-o-terminal-no-lugar-certo)), com o `gh` (o programa do
GitHub) já logado. O agente te passa o comando com o `<sha>` e o `<dpl_...>` já preenchidos.

### Antes de abrir: as regras da sessão

- **PC desligado ou suspenso desde a última sessão? Rode a faxina ANTES de tudo** (passo 7). Se o
  PC dormiu com uma sessão aberta, o segredo pode ter ficado no GitHub.
- **A sessão inteira tem de caber em 24 h.** O acesso da loja vence. A tela mostra o horário: a
  sessão fecha sozinha **45 minutos antes** de o acesso vencer. Se ela estiver no meio de um
  ensaio, espera o ensaio terminar e fecha logo depois, com a mensagem
  `o token vence às HH:MM; feche e abra outra sessão. Esta fecha agora.` Para continuar, abra
  outra sessão (passo 1).
- **Não rode o `nova-loja` da mesma loja enquanto a sessão estiver aberta.** A sessão segura a
  autorização da loja do começo ao fim. Outro comando da mesma loja fica esperando por ela ou
  atrapalha.
- **Só o dono pode ter escrita no repositório.** Se mais alguém tiver permissão de escrever (push)
  no repositório do GitHub, a sessão **não abre**: quem escreve consegue ler qualquer segredo por um
  workflow. Atenção: essa conferência olha só **pessoas**. Um **GitHub App** (um aplicativo
  instalado no repositório) com permissão de escrita **não aparece** nela. Antes da primeira
  sessão, confira com o agente que nenhum aplicativo instalado tem escrita.
- **Um comando por vez.** Nada de `&&`.

### Passo 1 — Abrir a sessão

Na janela do PowerShell, na pasta certa, cole o comando que o agente passou. Ele tem esta forma:

```powershell
node scripts/frota/publicar-release.mjs --sessao --sha <sha> --deployment <dpl_...>
```

- **O que aparece:** depois de alguns segundos, uma linha assim:
  `Sessão aberta. Segredos gravados no GitHub: SUPABASE_ACCESS_TOKEN_<SLUG>; vale até HH:MM (fecha sozinha às HH:MM). Cole os comandos gh workflow run em OUTRA janela.`
  Logo abaixo vem o relatório do primeiro ensaio e, no fim, a pergunta:
  `Enter = ensaio de novo · promover = publicar · sair = fechar a sessão >`
- **Como saber que deu certo:** a linha começa com `Sessão aberta.` e mostra só **nomes** de
  segredo, nunca um valor.
- **Se aparecer diferente:**
  - `A sessão NÃO abriu: ...`: nada ficou aberto. Copie **só essa linha** e mande para o agente.
    Se ela disser `além do dono, têm escrita no repositório: ...`, é a regra de escrita acima: tire
    a permissão dessa pessoa no GitHub ou fale com o agente. Se a mensagem trouxer
    `NÃO apagado: ... — rode: ...`, rode o comando que ela mostra, do jeito que está.
  - `--promover não se usa com --sessao`: o comando tem `--promover` a mais. Tire e rode de novo.
    Dentro da sessão, publicar é digitar `promover` (passo 5).

**Deixe esta janela aberta até o passo 6.** Ela é a sessão.

### Passo 2 — Ler o horário

Olhe o `vale até HH:MM` e o `fecha sozinha às HH:MM` da linha do passo 1. Todo o trabalho tem de
terminar antes do segundo horário. Se o horário estiver apertado para o que falta, fale com o
agente antes de seguir.

### Passo 3 — Colar os `gh workflow run` em OUTRA janela

Se o relatório disser `BLOQUEADO`, ele lista comandos `gh workflow run ...` (por exemplo, aplicar
migration ou publicar function na loja). **Não cole na janela da sessão**: ali o que você digita é
lido como Enter, `promover` ou `sair`.

1. Abra **outra** janela do Windows PowerShell (menu Iniciar, **Windows PowerShell**) e vá para a
   mesma pasta (`Set-Location "<pasta do repositório>"`).
2. Cole **um** comando `gh workflow run ...` por vez, na ordem em que o relatório mostra.
   - **O que aparece:** o `gh` confirma que o workflow foi disparado.
3. Descubra o número do run. Troque `<arquivo>.yml` pelo nome que aparece no comando que você
   colou (por exemplo `aplicar-migrations.yml`):

   ```powershell
   gh run list --workflow <arquivo>.yml --limit 1
   ```

   - **O que aparece:** uma linha com o run mais novo; o número comprido é o `<id>`.
4. Acompanhe até terminar:

   ```powershell
   gh run watch <id>
   ```

   - **Como saber que deu certo:** o run termina com ✓ (verde).
   - **Se terminar com X (vermelho):** não siga. Copie o nome do workflow e o número do run e mande
     para o agente.

### Passo 4 — Apertar Enter para o ensaio seguinte

Volte para a janela da **sessão** e aperte **Enter** (sem digitar nada).

- **O que aparece:** um relatório novo, com a pergunta de novo no fim.
- **Como saber que deu certo:** o relatório termina em `## 4. PRONTO — nenhum alvo bloqueia`,
  seguido da frase "Para publicar: digite promover na janela da sessão".
- **Se ainda disser `BLOQUEADO`:** volte ao passo 3 com os comandos novos que ele mostrar. Repita
  passo 3 e passo 4 até dar `PRONTO`.
- **Se aparecer `não entendi: aperte Enter (ensaio de novo), digite promover ou sair.`:** você
  digitou outra coisa. Aperte só Enter.

### Passo 5 — Digitar `promover`

Com o relatório dizendo `PRONTO`, digite na janela da sessão e aperte Enter:

```powershell
promover
```

- **O que aparece:** o relatório de novo, agora com a parte `## 5. Promoção` e a conferência da
  frota depois de publicar.
- **Como saber que deu certo:** a publicação passou e a sessão fecha sozinha (passo 6).
- **Se aparecer `run(s) ainda em andamento ou na fila`:** a publicação foi feita, mas ainda tem
  workflow da loja rodando, e ele precisa do segredo. A sessão **não fecha** enquanto isso. Espere
  o run terminar (o `gh run watch <id>` do passo 3, na outra janela) e digite `sair` na janela da
  sessão.
- **Se a conferência depois de publicar falhar:** a sessão continua aberta e o relatório traz o
  comando de desfazer. **Não rode nada sozinho:** copie a parte do relatório e mande para o agente.

Para fechar **sem** publicar, digite `sair` no lugar de `promover`. A regra dos runs em andamento
vale do mesmo jeito.

### Passo 6 — Como saber que a sessão fechou

- **O que aparece:**
  `Fechando a sessão: tirando os segredos das lojas OAuth do GitHub...` e, logo depois,
  `segredos apagados: N de N` (os dois números iguais). A janela volta para a linha que termina em
  `>`.
- **Como saber que deu certo:** os dois números são iguais e, ao rodar o comando abaixo, a
  resposta é `0`:

  ```powershell
  $LASTEXITCODE
  ```

  `0` = publicou (ou fechou depois de um ensaio PRONTO) e o GitHub ficou limpo.
- **Se aparecer diferente:**
  - `segredos apagados: 1 de 2` (números diferentes), `NÃO apagado: ...`, `NÃO confirmei em 8 s
    ...` ou `o fechar falhou`: **sobrou segredo no GitHub.** Vá para o passo 7 agora.
  - `$LASTEXITCODE` deu `1`: ou o último ensaio estava `BLOQUEADO`, ou sobrou segredo. Na dúvida,
    rode o passo 7: ele não estraga nada se não houver o que apagar.
  - `o token da loja ... não foi invalidado no fechar (vence sozinho às HH:MM)`: o segredo saiu do
    GitHub, mas o acesso que esteve lá só morre nesse horário. Avise o agente.

### Passo 7 — Faxina: janela fechada, falta de luz, PC dormiu ou saída 1

Use sempre que a sessão não terminou com `segredos apagados: N de N` e saída `0`: fechou a janela
no meio, faltou luz, o PC desligou ou suspendeu, ou o `$LASTEXITCODE` deu `1`. A faxina só apaga;
ela não renova nem publica nada.

```powershell
node scripts/frota/publicar-release.mjs --faxina
```

- **O que aparece:** `segredos apagados: SUPABASE_ACCESS_TOKEN_<SLUG>` (os nomes que ela tirou) ou
  `nenhum segredo de loja OAuth no GitHub: nada a apagar`.
- **Como saber que deu certo:** `$LASTEXITCODE` responde `0`.
- **Se aparecer `NÃO apagado: ... — rode: ...`:** rode o comando que a linha mostra, do jeito que
  está, e depois a faxina de novo. Se continuar, copie só essa linha e mande para o agente.
- **Se aparecer `A faxina falhou: ...`:** copie só essa linha e mande para o agente. Até ele
  responder, não abra outra sessão.

**Ctrl+C na janela da sessão** também fecha e apaga os segredos, mas sem esperar os runs: um run
que ainda estava na fila fica sem o segredo e para em `SEM_ACESSO`. Depois do Ctrl+C, confira o
passo 6 do mesmo jeito.

---

## Parte 4 — Armadilhas (todas vieram das revisões)

### E-mail com acento no PowerShell 5.1

O `Read-Host "e-mail" | node ...` passa pelo PowerShell 5.1, que, sem ajuste, manda o texto para o
Node em ASCII: uma letra com acento ou ç vira `?`. A contagem de caracteres continua igual, então
`e-mail recebido (N caracteres)` **não** denuncia a troca. O sintoma é o NÃO `nenhuma conta com esse
e-mail nesta loja` para um e-mail que você sabe que está cadastrado.

**Como evitar:** rode `$OutputEncoding = New-Object System.Text.UTF8Encoding $false` na mesma
janela, antes do `Read-Host`. O script descarta a marca de UTF-8 do começo, se vier. Nada é gravado
quando o e-mail chega errado: o script só recusa.

### Ctrl-C no meio de uma espera deixa uma trava órfã

`criar-projeto` espera até 5 minutos e `banco` faz centenas de pedidos. Se você interromper com
Ctrl-C, pode sobrar um arquivo `<slug>.trava`, e o próximo comando da loja recusa. Há duas
travas possíveis:
- `$env:LOCALAPPDATA\ikcous\frota\nova-loja\<slug>.trava`, a do comando;
- `$env:LOCALAPPDATA\ikcous\frota\acesso\<slug>.trava`, a do cofre.

**A mensagem do script diz o caminho exato do arquivo.** Antes de apagar, confira que nenhum
comando da loja está rodando (nenhuma outra janela com `node scripts/frota/...` da mesma loja).
Depois:

```powershell
Remove-Item "<caminho que a mensagem mostrou>"
```

E rode o mesmo comando de novo: ele retoma de onde parou.

### Com o gancho de e-mail desligado, o Supabase manda só 2 e-mails por hora

Enquanto o gancho estiver desligado, quem manda o e-mail de login é o serviço padrão do Supabase:
**2 e-mails por hora, e só para o time do projeto.** A lojista é dona da organização, então faz
parte do time e recebe. Por isso **ela confirma a conta da loja com o MESMO e-mail da conta
Supabase**: com outro e-mail, a confirmação não chega. Pedir para reenviar várias vezes só gasta o
limite.

### Depois de ligar o gancho, rode o login de novo

O limite de 30 e-mails por hora só é gravado com remetente próprio. Ligou o gancho (`ativar`)?
Rode `login-da-loja-nova.mjs --aplicar` **de novo**. Hoje o `ativar` não alcança loja nova (ver o
[passo 17](#passo-17--ligar-o-gancho-de-e-mail-e-subir-o-limite--lacuna-conhecida)).

### Depois das functions, a loja vira "existente"

O comentário de `functionsSoPeloWorkflow` (`scripts/frota/canais-de-backend.json`) manda pôr a
loja na lista depois que as functions sobem. **Numa loja só-OAuth, não ponha.** O
`publicar-functions.yml` só usa segredos fixos do repositório (linhas 136 e 211-213) e não alcança
a loja, e o `functions-da-loja.mjs` passaria a recusá-la. As functions de dinheiro ficariam
velhas, sem conserto. Detalhes no [passo 10](#passo-10--publicar-as-functions--ainda-não-automático-script-avulso).

### A instalação do banco bate no limite de pedidos por minuto

O `banco` faz **mais de 276 pedidos** (um por migration, mais as leituras). O Supabase aceita
cerca de **120 por minuto**. Quando passa, ele responde 429 (pedidos demais), e o comando trata
isso como INCERTO, porque não sabe se a última migration entrou. **Espere um minuto e rode o mesmo
comando de novo:** ele relê o ledger e retoma de onde parou. Pode precisar de algumas rodadas.

Se o 429 vier logo na primeira leitura, a do status do projeto, o veredito é **NÃO** com `HTTP 429`
na mensagem: nada foi enviado ao banco. O remédio é o mesmo: espere um minuto e rode de novo.

### Projeto novo leva até uns 5 minutos para ficar pronto

O status `ACTIVE_HEALTHY` pode demorar até cerca de 5 minutos. Qualquer SQL antes disso falha. Se
o `criar-projeto` der INCERTO por tempo, espere e rode de novo: ele não cria outro projeto.

### O código da Tela 2 é de uso único

Colou o código e deu INCERTO? Não cole o mesmo código de novo. Gere um link novo (`abrir`).

---

## Parte 5 — Como desfazer

| Passo | Como desfazer |
|---|---|
| `abrir` | Não precisa: rodar `abrir` de novo substitui a autorização pendente. Para abandonar a loja, apague `$env:LOCALAPPDATA\ikcous\frota\acesso\<slug>.dpapi` e `$env:LOCALAPPDATA\ikcous\frota\nova-loja\<slug>.json`, **só se a loja ainda não tem projeto**. |
| `receber` | Revogar a autorização. **Ainda não há comando para isso.** A lojista pode revogar pelo painel dela: Organization settings > OAuth Apps > Authorized apps > Revoke. Esse caminho vem de uma página de documentação do Supabase ainda em revisão (19/11/2026); confira na tela. Depois de revogar, os comandos da loja param de funcionar. |
| `criar-projeto` | O comando **nunca apaga projeto**. Apagar ou pausar é feito pela lojista, no painel dela, e é decisão do dono. |
| `banco` | **Não tem desfazer.** 115 das migrations não se repetem, e não existe "desinstalar". Numa loja sem venda, o caminho é apagar o projeto e começar de novo (decisão do dono). |
| `ficha` | Não tem o que desfazer: só lê e imprime. |
| `segredos` | Não se aplica hoje: o passo 8 espera o C2. O script nunca substitui. Se gravar só metade, o relatório dele manda apagar os segredos no painel do projeto (Edge Functions > Secrets), e esse painel é da lojista: a IKCOUS não entra nele. O C2 tem de trazer esse conserto por outro caminho. |
| `functions` | Sem comando de desfazer. Numa loja sem venda, uma function errada se corrige publicando de novo (`--aplicar --substituir`). |
| `login` | Sem comando de desfazer. O gancho nasce desligado, então nada deixa de funcionar. |
| `primeira-admin` | **Não tem desfazer pelo script.** Se a pessoa errada virou administradora, pare e leve ao dono. |
| `definir-dono` | **Lacuna conhecida:** numa loja nova, um dono errado **não tem conserto do lado da IKCOUS**. O passo `trocar-dono` ainda não existe. A troca de dono das lojas antigas (seção 4 de [definir-o-dono-da-loja.md](definir-o-dono-da-loja.md)) depende de SQL Editor no projeto, que a IKCOUS não abre na conta da lojista. |

## Lacunas conhecidas (26/11/2026)

**Condição antes da 1ª loja REAL (decisão do sócio):** o passo `trocar-dono` tem de existir. Sem
ele, um dono errado numa loja nova não tem conserto do lado da IKCOUS. Isso não é só uma lacuna:
nenhuma loja de lojista de verdade abre antes dele.

**Passos que não dá para usar numa loja nova** (a loja só tem a autorização OAuth da lojista, no
cofre do PC do dono; a IKCOUS não tem token fixo no repositório, nem chave de serviço, nem entrada
no painel do projeto dela):

- **segredos (passo 8):** `scripts/frota/segredos-da-loja.mjs` pede `SUPABASE_ACCESS_TOKEN` quando
  roda sozinho, e o token da lojista não sai do cofre. O conserto de "metade gravada" é no painel
  do projeto, que é da lojista. Espere o C2.
- **cadastro (passo 9):** `cadastro-da-loja.mjs` não existe. O roteiro manual
  (`producao-unica-fonte.md`, "Loja assinante nova", passos 1 a 3) pede o segredo fixo
  `SUPABASE_ACCESS_TOKEN_<LOJA>` no repositório e confere pelo `conferir-banco-da-loja.yml`, que usa
  esse segredo. Espere o B5/C2.
- **functions (passo 10):** depende do cadastro. Espere o B5/C2.
- **domínio, marca e chave do plano (passo 12):** a chave do plano vai pelo
  `instalar-chave-da-loja.yml` (segredo fixo, linhas 174-175); o domínio, pelo SQL Editor do projeto;
  a marca, pelo `scripts/identidade-bootstrap.mjs`, que exige a chave de serviço da loja (linha
  471). Espere o C2.
- **definir-dono (passo 15):** não existe; a receita manual (seção 3.3 de `definir-o-dono-da-loja.md`)
  é no SQL Editor do projeto. Espere o C3.
- **conferir (passo 18):** não existe; a reconciliação se lê pelo SQL Editor do projeto e a consulta
  88c, pelo SQL Editor ou pelos workflows com segredo fixo. Espere o C3.

**Release para loja só-OAuth ainda não existe.** A release de functions e de migrations para loja
só-OAuth ainda não existe: o `publicar-functions.yml` só usa segredos fixos do repositório
(linhas 136 e 211-213), e o mesmo vale para os outros workflows da frota. **Até lá a loja NÃO entra
em `functionsSoPeloWorkflow`** (`scripts/frota/canais-de-backend.json`), mesmo que o comentário
dessa lista diga o contrário. Se entrasse, o `functions-da-loja.mjs` passaria a recusá-la e as
functions de dinheiro ficariam velhas, sem conserto.

**Outras lacunas:**

- `segredos`, `functions`, `login`, `marca` e `chave-do-plano` ainda não estão no `nova-loja.mjs`.
- `ativar-email-do-login.yml` não alcança loja nova, porque só aceita lojas com token fixo no
  repositório.
- Não há comando para revogar a autorização da lojista (a peça `revogar` existe em
  `acesso-oauth.mjs`, sem passo no comando).
- A página `/autorizado` do app de gestão ainda não foi confirmada no ar.
- O roteiro inteiro ainda não foi ensaiado (C5).
