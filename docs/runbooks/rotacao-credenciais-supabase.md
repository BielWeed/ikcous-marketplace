# Como trocar as credenciais do Supabase — passo a passo

> ## ✅ Incidente encerrado em 30/07/2026 — a Parte 2 não é mais necessária
>
> Este runbook foi escrito no meio de uma investigação, assumindo que a `service_role`
> vazada estava viva. **Ela não está.** O teste que fecha o assunto:
>
> ```text
> Chave do histórico: role=service_role  emitida=2024-03-22  expira=2034-03-23
>   HTTP 401 — RECUSADA
> Chave viva hoje:    role=service_role  emitida=2026-02-06  expira=2036-02-06
> ```
>
> São chaves diferentes. A que ficou no histórico do git não é aceita pela API.
>
> Cuidado com os alertas de secret scanning do GitHub: o campo `secret` da API traz valores
> **sintéticos** (as assinaturas eram `N-8Z_Y9X-X-X-X-X` e `U4S_qS6U_qS6U_qS6U`). Alerta
> aberto não é prova de credencial válida — só a requisição autenticada é.
>
> | Item | Situação |
> | --- | --- |
> | `service_role` de produção no histórico | morta (401) |
> | Senha do banco de produção | rotacionada em 30/07/2026 |
> | `service_role` de `ykzlsunvbeclpxkuzskk` | projeto não existe mais |
> | Senha do banco de `jvgyjlbjhbfrncwbytls` | **única pendência** |
> | Repositório | privado |
>
> **O que ainda vale fazer:** a Parte 1 no projeto `jvgyjlbjhbfrncwbytls` (item 1.3), e fechar
> os 2 alertas do GitHub como *Revoked*.
>
> **A Parte 2 virou higiene opcional, não resposta a incidente.** Mexer na chave que a loja usa
> pra autenticar, sem credencial viva exposta, é trocar risco zero por risco pequeno mas real.
> Se um dia decidir migrar, a ordem correta está na Parte 2.

**Por que este runbook existe:** de 05/04 a 30/07/2026 o repositório era público e tinha, no
histórico, credenciais de três projetos Supabase espalhadas por 295 arquivos de script. A senha
do banco de produção era risco real e foi rotacionada. A `service_role` já estava morta.

**Quanto tempo:** a Parte 1 leva 10 minutos. A Parte 2, se você decidir fazer algum dia, 30.

---

## Leia isto antes de clicar em qualquer coisa

Você vai mexer em duas coisas diferentes, com riscos bem diferentes:

| O quê | O que acontece se der errado |
| --- | --- |
| **Senha do banco** | Seus scripts de terminal param de conectar. A loja continua no ar. Risco baixo. |
| **Chave `service_role`** | Pode derrubar a loja até você atualizar a Vercel e refazer o deploy. Risco alto. |

Por isso a ordem aqui é: **senha primeiro, chave depois.** A senha é o aquecimento.

### Escolha a hora

A Parte 2 pode deixar a loja fora do ar por 5–15 minutos. Faça de madrugada ou num
horário de pouco movimento. Não faça correndo, nem no meio de um dia de venda.

### Tenha isto aberto antes de começar

- O painel do Supabase: <https://supabase.com/dashboard>
- O painel da Vercel: <https://vercel.com/gabriels-projects-5a19f6ee/ickous-marketplace>
- O terminal, na pasta do projeto
- Um bloco de notas pra colar as chaves novas temporariamente

---

## PARTE 1 — Trocar a senha do banco (risco baixo)

São dois projetos. Faça um, confirme, depois o outro.

### 1.1 — Projeto de produção

1. Abra: <https://supabase.com/dashboard/project/cafkrminfnokvgjqtkle/settings/database>
2. Procure a seção **Database password** e o botão de **reset** / **gerar nova senha**
3. O Supabase vai gerar uma senha nova e **mostrar ela uma única vez**
4. **Copie e cole no bloco de notas agora.** Se fechar a tela sem copiar, você não vê
   de novo — teria que gerar outra
5. Confirme

Pronto. A senha antiga morreu neste instante.

### 1.2 — Avise que terminou

Me manda mensagem dizendo "trocei a senha de produção". Eu atualizo os arquivos do projeto
pra você — são 5 arquivos diferentes com essa senha dentro, e errar um deixa script quebrado
sem motivo aparente.

Se preferir fazer sozinho, o que precisa mudar é a linha `DATABASE_URL` em:

- `.env` ← este é o que os scripts usam de verdade
- `.env.production.local`
- `.env.vercel.prod`
- `.env.vercel.pulled`
- `.env.vercel.pulled.prod`

E na Vercel, a variável `DATABASE_URL` existe em **dois** ambientes (Production e
Development) — os dois precisam da senha nova.

### 1.3 — Projeto "br"

Mesma coisa, no outro projeto:

<https://supabase.com/dashboard/project/jvgyjlbjhbfrncwbytls/settings/database>

Este é o `ikcous-marketplace-br`, que não está sendo usado pela loja no ar. Então aqui não
tem risco nenhum e nem precisa atualizar arquivo — é só fechar a porta.

---

## PARTE 2 — Trocar a chave `service_role` (risco alto)

Esta é a parte que exige atenção.

### 2.1 — Entenda o que você vai ver

Abra: <https://supabase.com/dashboard/project/cafkrminfnokvgjqtkle/settings/api-keys>

Nesta tela existem dois mundos:

- **Chaves antigas (legacy)** — `anon` e `service_role`, as duas começando com `eyJ...`.
  É o que seu projeto usa hoje.
- **Chaves novas** — formato `sb_publishable_...` e `sb_secret_...`. Podem ser criadas e
  revogadas uma por uma, sem afetar as outras.

O detalhe que importa: as duas chaves antigas são assinadas pela mesma chave-mestra
(o *JWT secret*). **Se você rotacionar o JWT secret, as duas morrem juntas** — e a `anon`
é a que o site usa pra funcionar.

### 2.2 — Procure a opção menos destrutiva primeiro

Antes de rotacionar o JWT secret, procure na tela se existe:

- Um botão pra **revogar ou desabilitar apenas a `service_role` legada**, ou
- A opção de **migrar para as chaves novas** (`sb_secret_...`)

Se existir, use esse caminho: ele mata a chave vazada **sem** derrubar a loja.

> Não sei dizer o nome exato do botão — a interface do Supabase muda com frequência e eu
> não tenho acesso ao seu painel. Se ficar em dúvida sobre o que um botão faz, **tire um
> print e me manda antes de clicar.** Eu te digo o que é.

### 2.3 — Se só houver o caminho do JWT secret

Aí a loja vai cair por alguns minutos. Faça na ordem exata:

1. Rotacione o JWT secret no painel do Supabase
2. **Copie a `anon` key nova** (vai aparecer na mesma tela) pro bloco de notas
3. Vá na Vercel: **Settings → Environment Variables**
4. Edite `VITE_SUPABASE_ANON_KEY` e cole o valor novo
5. **Refaça o deploy** — só salvar a variável não basta. Essa chave entra no código no
   momento do build, então sem build novo o site continua com a chave velha.
   Na Vercel: aba **Deployments** → o último de Production → menu `···` → **Redeploy**
6. Espere ficar **Ready** (uns 2 minutos) e abra <https://ickous-marketplace.vercel.app>

### 2.4 — O que mais vai acontecer

- **Todos os clientes logados vão ser desconectados.** As sessões são assinadas pela
  chave-mestra antiga. Eles só precisam entrar de novo, não perdem nada.
- As 3 edge functions (`calculate-shipping`, `send-otp-email`, `send-push`) **não precisam
  de nada** — o Supabase entrega a chave nova pra elas automaticamente.

---

## PARTE 3 — Conferir que deu tudo certo

Depois de terminar, me chama que eu rodo a verificação. Ou faça você mesmo:

1. Abra <https://ickous-marketplace.vercel.app> e veja se os produtos carregam.
   Produto aparecendo = a `anon` nova está funcionando.
2. Adicione algo ao carrinho e vá até o checkout, sem finalizar.
3. Entre no painel admin e veja se a lista de pedidos carrega.
4. No GitHub, marque os alertas como resolvidos:
   <https://github.com/BielWeed/ikcous-marketplace/security/secret-scanning>
   Em cada um: **Close as** → **Revoked**.

---

## Se algo quebrar

**A loja abre em branco ou fica travada carregando**
A `anon` key nova não chegou no build. Confira se você salvou a variável na Vercel **e**
refez o deploy. Só salvar não resolve.

**Os produtos não aparecem, mas a página abre**
Provavelmente a `anon` foi atualizada mas há cache do Service Worker. Abra numa janela
anônima pra confirmar antes de mexer em mais nada.

**Um script de terminal dá erro de senha**
Normal se você trocou a senha e não atualizou o `.env`. Volte ao passo 1.2.

**Você fechou a tela sem copiar a chave nova**
Sem problema — gere outra. Não tem limite. O incômodo é só repetir os passos.

---

## O que NÃO fazer, em nenhuma hipótese

- **Não rode `supabase db push`.** Neste projeto o histórico de migrations divergiu do banco
  real; esse comando pode derrubar a loja de verdade.
- **Não apague nenhum projeto** no painel do Supabase.
- **Não mexa em RLS, policies ou tabelas** durante a rotação. Uma coisa por vez.
- **Não cole senha nem chave em arquivo de código.** Só em `.env` (que é ignorado pelo git)
  ou no painel da Vercel. Foi exatamente isso que causou o vazamento.
