# Reserva da caderneta — ligar, provar e desfazer

**O que é, em uma frase:** a caderneta é o cadastro que diz ao porteiro "este endereço é a loja X, com o banco Y".
Se ela cair, as lojas que estão sem ficha recente mostram "em manutenção". A **reserva** é uma cópia pequena e
pública desse cadastro (só endereço → banco e chave pública), guardada na **Global Config** da Vercel (o antigo
"Edge Config"). Com ela ligada, se a caderneta falhar, o porteiro abre cada loja pela reserva, e o banco de cada
loja continua conferindo o próprio domínio.

Plano de origem: `PLANO-RESERVA-DA-CADERNETA-26-11.md` (T12 e T13). Scripts:
[`reserva-da-caderneta.mjs`](../../scripts/frota/reserva-da-caderneta.mjs) (grava a reserva),
[`sondar-candidato.mjs`](../../scripts/frota/sondar-candidato.mjs) (prova o deploy candidato) e
[`conferir-frota.mjs`](../../scripts/frota/conferir-frota.mjs) (confere as lojas no ar).

> [!CAUTION]
> **Só preencha o `globalConfigId` em `scripts/frota/politica.json` DEPOIS que o porteiro novo (o que lê a reserva)
> estiver no ar.** Com o campo preenchido, toda publicação passa a exigir que o deploy novo diga
> `x-ikcous-reserva: ligada`. Se o porteiro que está sendo publicado ainda não souber ler a reserva, **toda release
> fica BLOQUEADA**. A ordem certa é: criar e conectar a store (passos 1 e 2), publicar o porteiro novo (passo 3), e só
> então preencher o campo (passo 4).

> [!IMPORTANT]
> **Publicação só a partir de 01/12/2026**, depois da Black Friday, porque o porteiro novo vai para a Savy. Faça em
> hora calma e **nunca numa sexta**. Os passos 1 e 2 (criar e conectar a store) podem ser feitos antes, porque não
> mudam nada no ar: o porteiro de hoje não lê a Global Config.

## Como ler esta receita

- Os comandos são para o **Windows PowerShell** (a janela azul). Copie **um bloco por vez**, cole, aperte Enter e
  espere terminar antes do próximo.
- Onde aparece `<sha40>`, `<dpl_...>` ou `<endereço do candidato>`, o agente manda o comando já preenchido. Não
  invente esses valores.
- **Nunca copie o token nem a "connection string"** da Global Config (o texto que começa com
  `https://global-config.vercel.com/...?token=`). Esse texto é segredo: não cole em conversa, arquivo nem commit. O
  **ID** da store (começa com `ecfg_`) não é segredo.
- Todo comando abaixo roda na pasta onde você já roda a publicação (a cópia limpa do ramo da release, a mesma de
  [produção — fonte única](producao-unica-fonte.md)).

## Passo 1 — Criar a Global Config (no Chrome)

1. Abra <https://vercel.com/dashboard> no Chrome e confira, no canto de cima à esquerda, que o time escolhido é o
   **gabriels-projects-5a19f6ee**.
2. No menu da esquerda, clique em **Storage**.
3. Clique no botão **Create Storage**. Na lista, escolha **Global Config** e clique em **Continue**.
4. No campo do nome, digite `reserva-da-caderneta` e clique em **Create**.

**O que aparece:** a página da store nova, com uma lista de itens que já traz um exemplo
`"greeting": "hello world"`. No alto da página aparece o ID, que começa com `ecfg_`.

**Deu certo se:** você está na página da store e o ID começa com `ecfg_`. O item `greeting` pode ficar; ele não
atrapalha.

**Se aparecer diferente:**
- Aparece **Edge Config** no lugar de Global Config: é o mesmo produto com o nome antigo. Escolha **Edge Config**.
- Aparece aviso de **limite** ("limit", "upgrade", pedido de cartão): **pare e não aceite nada**. O plano grátis só
  permite 1 store. Mande um print para o agente.

## Passo 2 — Conectar a store ao projeto, só em Production

1. Na página da store, no menu da esquerda, clique em **Projects**.
2. Clique em **Connect Project**.
3. Na lista, escolha o projeto **ickous-marketplace**.
4. Abra **Advanced Options**. Na parte dos ambientes (Environments), deixe marcado **só Production**. Desmarque
   **Preview** e **Development**.
5. Clique em **Connect**.

**O que aparece:** o projeto `ickous-marketplace` na lista de projetos conectados.

**Confira a variável:**
1. Abra o projeto **ickous-marketplace** e vá em **Settings**, depois em **Environment Variables**.
2. Procure `GLOBAL_CONFIG`.

**Deu certo se:** `GLOBAL_CONFIG` existe e aparece **só com Production**.

**Se aparecer diferente:**
- `GLOBAL_CONFIG` aparece também com Preview ou Development: clique nos três pontinhos da linha, depois em **Edit**.
  Desmarque Preview e Development e clique em **Save**.
- A janela de conectar não mostrou a escolha de ambientes: conecte assim mesmo e corrija a variável como no item
  acima.
- Apareceu o aviso de que o projeto **já tem** `GLOBAL_CONFIG`: **pare** e mande um print para o agente. Não troque
  o nome da variável.

**Depois:** avise o agente: "criei e conectei a Global Config". Se quiser, mande também o ID `ecfg_...`; o agente
também consegue lê-lo sozinho.

## Passo 3 — Publicar o porteiro novo (a partir de 01/12)

É a publicação de sempre, pela receita de [produção — fonte única](producao-unica-fonte.md). Nesta publicação, o
`globalConfigId` **ainda é `null`**, e o relatório do portão mostra, na parte **4b. Reserva da caderneta**, um
**AVISO** de que a reserva não está configurada. Isso é o esperado.

Depois que a publicação terminar, confira que o porteiro novo enxerga a store. O agente manda o comando com o
endereço do deploy promovido:

```powershell
curl.exe -s -D - -o NUL "https://<endereço do deploy promovido>.vercel.app/" | Select-String "x-ikcous"
```

**Deu certo se:** aparece a linha `x-ikcous-reserva: ligada`.

**Se aparecer diferente:**
- Aparece `x-ikcous-reserva: desligada`: o deploy não recebeu a `GLOBAL_CONFIG`. Volte ao passo 2 e confira que ela
  está marcada em Production. **Não siga** para o passo 4.
- Não aparece nenhuma linha `x-ikcous-reserva`: o porteiro no ar ainda é o antigo. **Não siga** para o passo 4.

## Passo 4 — Preencher o `globalConfigId` (o agente faz)

Só depois que o passo 3 mostrou `ligada`, o agente troca `"globalConfigId": null` pelo ID `ecfg_...` em
`scripts/frota/politica.json`, num PR revisado. A partir dele, toda publicação grava a reserva antes de promover e
exige `x-ikcous-reserva: ligada` no deploy novo.

## Passo 5 — Primeira gravação da reserva

1. Ver a diferença, sem gravar nada:

   ```powershell
   node scripts/frota/reserva-da-caderneta.mjs --conferir --sha <sha40>
   ```

   **O que aparece:** `# Reserva da caderneta`, a linha `Montada: N endereços, ... bytes`,
   `Na store: nenhuma reserva gravada ainda.` e `Diferente da atual: --gravar gravaria.`, seguida da lista de lojas
   que entram (`- entra: <endereço>`).

2. Gravar:

   ```powershell
   node scripts/frota/reserva-da-caderneta.mjs --gravar --sha <sha40>
   ```

   **Deu certo se:** a última linha é `Gravada e conferida na releitura.` Na página da store (passo 1), o item
   `reserva_v1` aparece na lista.

3. Espere **6 minutos** antes do passo 6. A Global Config leva até 10 segundos para chegar a todas as regiões, e cada
   cópia do porteiro guarda a reserva por até 5 minutos.

**Se aparecer diferente:**
- Linha começando com `RECUSADA:`: nada foi gravado. Copie a saída inteira para o agente. O motivo diz qual endereço
  ou loja falta.
- Linha começando com `COTA:`: o limite de gravações do mês acabou. Nada foi gravado. Avise o agente.
- `NÃO CONFIGURADA` ou `globalConfigId é null`: o passo 4 ainda não está no ramo que você está usando.

## Passo 6 — Ensaio: três deploys de prova

São três deploys **que nunca vão ao ar** (`--skip-domain` não muda o endereço de nenhuma loja). A variável
`IKCOUS_SONDA_DO_CANDIDATO=1` liga, só neles, a rota que o `sondar-candidato` usa.

Para cada deploy, **guarde duas coisas** que o comando imprime: o endereço `https://...vercel.app` (é o "endereço
do candidato") e o `dpl_...`. Se o `dpl_...` não aparecer, rode `vercel inspect <endereço do candidato>` e copie a
linha `id`.

**6a. Controle (caderneta normal):**

```powershell
vercel --prod --skip-domain --yes --scope gabriels-projects-5a19f6ee --build-env IKCOUS_CODE_SHA=<sha40> --build-env VERCEL_GIT_COMMIT_SHA=<sha40> --env IKCOUS_SONDA_DO_CANDIDATO=1
```

**6b. Prova 1 (caderneta que não existe):**

```powershell
vercel --prod --skip-domain --yes --scope gabriels-projects-5a19f6ee --build-env IKCOUS_CODE_SHA=<sha40> --build-env VERCEL_GIT_COMMIT_SHA=<sha40> --env IKCOUS_SONDA_DO_CANDIDATO=1 --env IKCOUS_FROTA_URL=https://caderneta-errada.invalid
```

**6c. Prova 2 (caderneta vazia):** o agente manda o comando completo. Ele é igual ao 6b, mas aponta
`IKCOUS_FROTA_URL` para um banco com a caderneta vazia, com a chave **pública** desse banco.

**O ensaio do portão em cada um** (só lê, não promove nada):

```powershell
node scripts/frota/publicar-release.mjs --sha <sha40> --deployment <dpl_... do deploy>
```

**Deu certo se:**
- no **controle (6a)**, o resultado é o de sempre de uma release boa: `## 4. PRONTO — nenhum alvo bloqueia`;
- nas **provas 1 e 2 (6b e 6c)**, o resultado é `## 4. BLOQUEADO — o front NÃO foi promovido`, com o motivo
  `esperado miss ou hit: a caderneta da frota não respondeu ao candidato`. **Aqui BLOQUEADO é o certo:** o portão
  não pode deixar ir ao ar um deploy cuja caderneta não responde.

**Se aparecer diferente:**
- Uma prova (6b ou 6c) deu **PRONTO**: **pare tudo**, não promova nada e mande a saída para o agente. O portão
  deixaria passar um deploy com a caderneta caída.
- O controle (6a) deu BLOQUEADO: leia o motivo. Se for a caderneta ou a reserva, mande a saída para o agente.

## Passo 7 — `sondar-candidato`: cada loja abre com o banco certo?

Rode um deploy por vez, nunca dois ao mesmo tempo. Cada um leva **cerca de 1 segundo por endereço** (300 lojas são
uns 5 minutos). Enquanto roda, aparece `Sondando N endereços no candidato...` e, a cada 30, `... 30 de N sondados`.

**7a. Controle**, exigindo a caderneta normal (`hit`):

```powershell
node scripts/frota/sondar-candidato.mjs --candidato <endereço do candidato do 6a> --caderneta hit
```

**7b. Prova 1**, exigindo a reserva:

```powershell
node scripts/frota/sondar-candidato.mjs --candidato <endereço do candidato do 6b> --caderneta reserva
```

**7c. Prova 2**, exigindo a reserva:

```powershell
node scripts/frota/sondar-candidato.mjs --candidato <endereço do candidato do 6c> --caderneta reserva
```

**Deu certo se**, nos três, a última linha é `RESULTADO: SIM — toda loja abriu no candidato com o banco certo.` Na
prova 1 (7b), a linha `Caderneta para onde o candidato aponta:` mostra `caderneta-errada.invalid`. Isso prova que o
deploy de prova estava mesmo com a caderneta errada.

**Se aparecer diferente:**
- `RESULTADO: NÃO`: o candidato abriria alguma loja errada, ou não abriria. As linhas `- ERRADO:` dizem qual. **Não
  promova** e mande a saída para o agente.
- `RESULTADO: INCERTO`: não deu para provar, e isso **não** conta como SIM. As linhas depois do resultado dizem o
  porquê:
  - `respondeu 404`: o endereço usado não é o endereço único do deploy (talvez seja o apelido), ou o deploy foi
    feito sem `--env IKCOUS_SONDA_DO_CANDIDATO=1`. Confira o endereço e rode de novo.
  - `respondeu 429`: outra prova estava rodando ao mesmo tempo. Espere 2 minutos e rode de novo, uma por vez.
  - `erro de rede` ou `sem resposta`: confira a internet e rode de novo.
  - `inventário PARCIAL` ou `resultado indeterminado no inventário`: alguma loja no ar não respondeu firme. Rode o
    `conferir-frota` (passo 8) e mande as duas saídas para o agente.
- Na prova 1 aparece `hit` em vez de `reserva`, ou a caderneta apontada não é `caderneta-errada.invalid`: o `--env`
  não trocou a variável neste deploy. Mande a saída para o agente.

**Depois das provas — apagar os três deploys de prova** (recomendado, para ninguém promover um deles por engano):

```powershell
vercel remove <endereço do candidato do 6a> --yes --scope gabriels-projects-5a19f6ee
```

```powershell
vercel remove <endereço do candidato do 6b> --yes --scope gabriels-projects-5a19f6ee
```

```powershell
vercel remove <endereço do candidato do 6c> --yes --scope gabriels-projects-5a19f6ee
```

**Nunca rode `vercel promote` num deploy de prova.** O da prova 1 deixaria todas as lojas dependendo só da reserva.

## Passo 8 — `conferir-frota`: as lojas no ar seguem bem?

```powershell
node scripts/frota/conferir-frota.mjs --sha <sha40 que está no ar> --vercel
```

**Deu certo se:** aparece `inventário: COMPLETO` e a linha `Resultado: N de N endereços OK` com os dois números
iguais (lojas fora do ar por decisão aparecem à parte, como `(+ M fora do ar por decisão)`).

**Se aparecer diferente:** algum endereço com classe diferente de OK. Mande a saída inteira para o agente. Se a
classe for `CADERNETA_NA_RESERVA`, a caderneta de produção está falhando **agora** e as lojas estão abrindo pela
reserva. A reserva está funcionando, mas a caderneta precisa de conserto.

## Desfazer

Há dois jeitos. O primeiro é imediato; o segundo é o desligamento completo.

### Desfazer rápido: apagar `reserva_v1` (vale em até ~6 minutos)

1. Abra a store (Chrome → **Storage** → `reserva-da-caderneta`).
2. No painel da direita, que mostra os itens em JSON, apague a chave `"reserva_v1"` inteira, com o valor dela.
   Cuidado com as vírgulas: o JSON tem de continuar válido.
3. Clique em **Save**.

**O que acontece:** em até 10 segundos a store não tem mais a reserva e, em até 5 minutos, nenhuma cópia do porteiro
a usa. Se a caderneta cair depois disso, as lojas sem ficha recente voltam a mostrar "em manutenção" (o
comportamento de antes).

**Atenção:** enquanto o `globalConfigId` estiver preenchido, a **próxima publicação grava a reserva de novo**. Para
desligar de vez, siga o desligamento completo.

**Voltar atrás:** a store guarda cópias por 7 dias. Em **Backups**, escolha a versão anterior e clique em
**Restore**. Ou rode de novo o passo 5.

### Desligamento completo (nesta ordem)

1. Faça o **desfazer rápido** acima.
2. O agente volta o `globalConfigId` para `null` em `scripts/frota/politica.json`, num PR revisado. **Antes** do
   item 3: com o campo preenchido e a store desconectada, toda release fica BLOQUEADA.
3. Desconectar a store: na store, clique em **Projects**, nos três pontinhos da linha do `ickous-marketplace`, em
   **Remove Project Connection** e confirme em **Remove Connection**.
4. A próxima publicação sai sem a `GLOBAL_CONFIG`. O porteiro passa a dizer `x-ikcous-reserva: desligada` e não
   procura reserva nenhuma.

**Para ligar de novo:** passo 2 (conectar), passo 3 (publicar), passo 4 (preencher o ID) e passo 5 (gravar).
