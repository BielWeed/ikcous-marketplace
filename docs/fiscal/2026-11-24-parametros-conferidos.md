# Parâmetros da lei conferidos em fonte oficial — Gestão Fiscal, fase 1

- **Data de todas as consultas:** 24/11/2026 (salvo indicação).
- **Escopo:** itens L1 a L11 da seção 2 de `equipe/gestao-fiscal/plano-fase1-24-11.md`.
- **Regra:** só entra no código o que está **CONFERIDO**. **NÃO CONFERIDO** e **CONFLITANTE** ficam
  fora do código, e a tela mostra um aviso no lugar do número.
- **Como as páginas foram lidas:** o Planalto recusa robô (conexão cortada no `curl`) e o sistema de
  normas da Receita monta a página por JavaScript. As duas foram abertas no navegador, e o texto foi
  lido na própria página. Para achar um artigo, basta usar Ctrl+F com o número do artigo.

## Fontes primárias usadas (URLs exatas)

| Sigla | Norma | URL |
|---|---|---|
| P-123 | LC 123/2006, texto compilado (Planalto) | https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm |
| P-238 | LC 238, de 21/10/2026 (Planalto; DOU 21/10/2026, edição extra) | https://www.planalto.gov.br/ccivil_03/leis/lcp/Lcp238.htm |
| P-214 | LC 214/2025, texto compilado (Planalto) | https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm |
| R-140 | Resolução CGSN 140/2018, versão vigente (Normas RFB) | https://normasinternet2.receita.fazenda.gov.br/#/consulta/externa/92278/visao/vigente |
| R-190 | Resolução CGSN 190, de 04/08/2026 (DOU 10/08/2026) | https://normasinternet2.receita.fazenda.gov.br/#/consulta/externa/152832 |
| R-196 | Resolução CGSN 196, de 16/11/2026 (**DOU 24/11/2026**, hoje) | https://normasinternet2.receita.fazenda.gov.br/#/consulta/externa/154694 |
| PSN-MEI26 | Portal do Simples Nacional: "MEI - atualização de valores devidos em 2026" (02/01/2026) | https://www8.receita.fazenda.gov.br/simplesnacional/Noticias/NoticiaCompleta.aspx?id=c3b2044c-ff97-432a-b33c-ecf2a3df6dc3 |
| PSN-PGDAS | Portal do Simples Nacional: "PGDAS-D é atualizado para atender à Reforma Tributária" (13/11/2026) | https://www8.receita.fazenda.gov.br/simplesnacional/Noticias/NoticiaCompleta.aspx?id=92a6104d-cbde-490c-9aa0-aebcca3d3310 |
| D-12797 | Decreto 12.797/2025, salário mínimo de 2026 (Planalto) | https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/decreto/d12797.htm |
| S-XVIII | Senado, LC 214/2025, Anexo XVIII (a nova redação do Anexo I da LC 123) | https://legis.senado.leg.br/norma/40180341/publicacao/40181079 |

Segundas fontes não oficiais (só como confirmação): Agência Brasil (EBC)
[LC 238](https://agenciabrasil.ebc.com.br/economia/noticia/2026-10/sancionada-lei-que-perdoa-divida-e-aumenta-limite-de-mei)
e [DAS-MEI 2026](https://agenciabrasil.ebc.com.br/economia/noticia/2026-01/recolhimento-do-mei-sobe-para-r-8105-em-2026);
Contabilizei, [Anexo I](https://www.contabilizei.com.br/contabilidade-online/anexo-1-simples-nacional/)
(página atualizada em 06/11/2026).

> **Aviso sobre o texto compilado do Planalto:** em 24/11/2026 o P-123 ainda mostra a redação antiga
> do art. 18-A (R$ 81.000,00 e R$ 6.750,00), com a anotação "Vide Lei Complementar nº 238, de 2026".
> O texto novo está na própria P-238. A R-140 (art. 100) também continua com R$ 81.000,00: o CGSN
> ainda não regulamentou a LC 238.

---

## L1 — Teto anual do MEI (2026, 2027, 2028) e vigência

| Ano-calendário | Teto anual | Dispositivo | Vigência |
|---|---|---|---|
| 2026 | **R$ 81.000,00** | LC 123 art. 18-A §1º (redação da LC 188/2021, valor da LC 155/2016); R-140 art. 100, caput | até 31/12/2026 |
| 2027 | **R$ 110.000,00** | LC 238/2026, art. 2º, caput | ano-calendário 2027 |
| 2028 em diante | **R$ 140.000,00** | LC 238/2026, art. 1º (nova redação do art. 18-A §1º da LC 123) + art. 10, I | a partir de 01/01/2028 |

- **Lei:** LC 238, de 21/10/2026, publicada no DOU de 21/10/2026, edição extra (P-238). A data do
  sócio confere: sancionada em 21/10/2026.
- **Vigência (P-238, art. 10):** a lei entra em vigor na publicação. A mudança do art. 18-A §§1º e 2º
  vale a partir de 01/01/2028. O resto da lei vale a partir de 01/01/2027, e isso inclui o art. 2º,
  que fixa R$ 110 mil para 2027.
- **Condição legal (P-238, art. 3º):** a ampliação do limite depende de a renúncia de receita
  constar da lei orçamentária anual de 2027 a 2029, por causa do art. 14 da Lei de Responsabilidade
  Fiscal. Não conferi se a LOA de 2027 já foi aprovada com essa previsão.
- **Regulamentação:** a R-140, art. 100, ainda diz R$ 81.000,00 (24/11/2026).
- **Segunda fonte:** Agência Brasil (EBC), link acima: R$ 81 mil em 2026, R$ 110 mil em 2027 e
  R$ 140 mil em 2028, sanção em 21/10/2026.
- **Status:**
  - 2026: **CONFERIDO**.
  - 2027 e 2028: **CONFERIDO no texto da lei, com condição pendente** (LOA, art. 3º, e falta a
    regulamentação do CGSN). Fica fora do código até a condição ser conferida. Ver "O que fica fora
    do código".

## L2 — Teto proporcional no ano de abertura (MEI)

Regra: o valor mensal abaixo é multiplicado pelo número de meses entre o início da atividade e o fim
do ano-calendário. Fração de mês conta como mês inteiro.

| Ano de abertura | Valor por mês | Dispositivo |
|---|---|---|
| 2026 | **R$ 6.750,00** | LC 123 art. 18-A §2º (redação da LC 155/2016); R-140 art. 100 §1º |
| 2027 | **R$ 9.166,67** | LC 238 art. 2º, parágrafo único |
| 2028 em diante | **R$ 11.666,67** | LC 238 art. 1º (nova redação do art. 18-A §2º) + art. 10, I |

- A R-140 (art. 100 §1º) conta do "mês de início de atividade" até o fim do ano.
- A partir de 2027, a R-196 (art. 2º, inciso V da R-140, com efeitos em 01/01/2027) define a data
  de início de atividade como a data de inscrição no CNPJ.
- **Segunda fonte:** a R-140 art. 100 §1º confere o valor de 2026 (duas fontes oficiais). Para 2027
  e 2028 há uma só fonte, a própria lei.
- **Status:**
  - 2026: **CONFERIDO**.
  - 2027 e 2028: **CONFERIDO no texto da lei, com a mesma condição do L1**. Fica fora do código pelo
    mesmo motivo.

## L3 — Excesso do MEI (até 20% / acima de 20%) e efeito

| Situação | Efeito do desenquadramento | Dispositivo |
|---|---|---|
| Passou do teto anual em **até 20%** | a partir de 1º de janeiro do ano seguinte; a diferença é paga sem acréscimos junto com o DAS de janeiro | LC 123 art. 18-A §7º, III, "a", e §10; R-140 art. 115 §2º, II, "a", 1 |
| Passou do teto anual em **mais de 20%** | retroativo a 1º de janeiro do ano do excesso; passa a recolher pelo Simples "normal" | LC 123 art. 18-A §7º, III, "b", e §9º; R-140 art. 115 §2º, II, "a", 2 |
| Ano de abertura, passou do teto proporcional em até 20% | a partir de 1º de janeiro do ano seguinte | LC 123 art. 18-A §7º, IV, "a" |
| Ano de abertura, passou do teto proporcional em mais de 20% | retroativo ao início da atividade | LC 123 art. 18-A §7º, IV, "b"; R-140 art. 115 §2º, II, "a", 3 |

- **Prazo para comunicar:** até o último dia útil do mês seguinte ao do excesso (§7º, III e IV).
- **A lei nova mexeu nisso?** Não: a LC 238 não altera o §7º (P-238 só reescreve os §§1º, 2º e 3º, V,
  do art. 18-A). Os 20% passam a ser medidos sobre o teto novo de cada ano.
- **Trecho-chave** (LC 123 art. 18-A §7º, III, "b"): "na hipótese de ter ultrapassado o referido
  limite em mais de 20% (vinte por cento)".
- **Faixas do medidor do parecer:** até 100% / de 100% a 120% / acima de 120% batem com a lei.
- **Segunda fonte:** R-140 art. 115 (oficial).
- **Status:** **CONFERIDO**.

## L4 — DAS-MEI do ano por atividade

**2026** (PSN-MEI26; D-12797; R-140 art. 101):

| Atividade | INSS (5% de R$ 1.621,00) | ICMS | ISS | **Total mensal** |
|---|---|---|---|---|
| Comércio / indústria | R$ 81,05 | R$ 1,00 | — | **R$ 82,05** |
| Serviço | R$ 81,05 | — | R$ 5,00 | **R$ 86,05** |
| Comércio + serviço | R$ 81,05 | R$ 1,00 | R$ 5,00 | **R$ 87,05** |

- **De onde vem cada parcela:**
  - INSS: 5% do limite mínimo do salário de contribuição (R-140 art. 101, I, "b").
  - Salário mínimo de 2026: R$ 1.621,00, a partir de 01/01/2026 (D-12797, art. 1º).
  - ICMS de R$ 1,00 e ISS de R$ 5,00: R-140 art. 101, II e III; LC 123 art. 18-A §3º, V, "b" e "c".
- **Conta das parcelas:** PSN-MEI26 traz as três parcelas (R$ 81,05, R$ 5,00 e R$ 1,00). Os totais
  da tabela são a soma delas.
- **Nota:** a alínea "a" do texto da lei ainda mostra R$ 45,65, valor antigo. O valor real segue o §11
  do art. 18-A, que manda reajustar com o salário mínimo, e a R-140 art. 101, I, "b".
- **Pista do sócio:** R$ 82,05 está **certo**. R$ 82,35 está **errado**: não bate com 5% de R$ 1.621
  nem com a página da Receita.
- **Segunda fonte:** Agência Brasil (EBC): base de R$ 81,05, mais R$ 1 de ICMS, R$ 5 de ISS ou R$ 6
  nos dois.
- **Vigência:** competências de janeiro a dezembro de 2026.
- **2027:** **NÃO CONFERIDO**, por dois motivos:
  - Não procurei nem achei o decreto do salário mínimo de 2027.
  - A composição muda em 01/01/2027. A LC 214, art. 520, acrescenta o Anexo VII à LC 123, com
    efeitos em 01/01/2027 (art. 544, III). O Anexo VII fixa valores para 2027 e 2028: ICMS R$ 1,00,
    ISS R$ 5,00, CBS R$ 0,994, IBS R$ 0,006 e total R$ 7,00 (P-214, Anexo XXIII). Não conferi como
    cada parcela se aplica a cada atividade. A regra está no Anexo XIII da R-140, na redação da
    R-190, que não abri.
- **Status:**
  - 2026: **CONFERIDO**.
  - 2027: **NÃO CONFERIDO**.

## L5 — Vencimento do DAS (MEI e Simples) e regra de dia não útil

- **Simples (ME/EPP):** paga até o **dia 20 do mês seguinte** ao da receita (R-140 art. 40, caput).
- **MEI:** o DAS mensal vence no mesmo prazo do art. 40 (R-140 art. 104 §2º). Também é **dia 20 do
  mês seguinte**.
- **Dia sem expediente bancário:** o vencimento passa para o dia útil imediatamente seguinte (R-140
  art. 40 §3º). É prorrogação, não antecipação.
  - Atenção: a regra fala em "expediente bancário", não em feriado nacional. Feriado local pode
    contar. Uma tabela só de feriados nacionais pode errar em alguma cidade.
- **Calamidade pública:** o vencimento pode ser prorrogado por até 6 meses para municípios atingidos
  (R-140 art. 40-A). Já aconteceu em 2026 em municípios de MG, segundo a lista de notícias do Portal
  do Simples Nacional.
- **Nota sobre a lei:** a LC 123 art. 21, III, tem um prazo provisório ("último dia útil da primeira
  quinzena"). Ele vale só enquanto o CGSN não regulamentar, e o CGSN regulamentou no art. 40 acima.
- **Segunda fonte:** Agência Brasil (EBC), matéria do DAS-MEI 2026: vence todo dia 20.
- **Vigência:** a R-140 não mostra alteração agendada para 2027 no art. 40.
- **Status:** **CONFERIDO** (dia 20, prorroga para o dia útil seguinte).

## L6 — Anexo I do Simples (comércio)

**Redação vigente em 2026** (LC 123, Anexo I, redação da LC 155/2016, vigência desde 01/01/2018;
P-123):

| Faixa | RBT12 (R$) | Alíquota nominal | Parcela a deduzir (R$) |
|---|---|---|---|
| 1ª | até 180.000,00 | 4,00% | — |
| 2ª | 180.000,01 a 360.000,00 | 7,30% | 5.940,00 |
| 3ª | 360.000,01 a 720.000,00 | 9,50% | 13.860,00 |
| 4ª | 720.000,01 a 1.800.000,00 | 10,70% | 22.500,00 |
| 5ª | 1.800.000,01 a 3.600.000,00 | 14,30% | 87.300,00 |
| 6ª | 3.600.000,01 a 4.800.000,00 | 19,00% | 378.000,00 |

**Redação para 2027 e 2028** (LC 214/2025, art. 519 + Anexo XVIII, efeitos em 01/01/2027 pelo
art. 544, III, na redação da LC 227/2026; P-214 e S-XVIII):

- **Faixas 1ª a 5ª:** iguais à tabela acima.
- **6ª faixa:** alíquota **18,90%** (era 19,00%), parcela a deduzir R$ 378.000,00.
- **Partilha:** PIS e Cofins saem; entram CBS e IBS. Na 1ª e 2ª faixas: IRPJ 5,50%, CSLL 3,50%,
  CBS 15,33%, CPP 41,50%, ICMS 34,00%, IBS 0,17%.
- **A partir de 2029:** a 6ª faixa volta a 19,00%. As demais não mudam.

Detalhes e fontes:

- **Segunda fonte, 2026:** Contabilizei (atualizada em 06/11/2026), mesmos 6 pares de alíquota e
  dedução.
- **Segunda fonte, 2027 e 2028:** S-XVIII, no Senado (oficial), confirma 18,90% para 2027–2028 e
  19,00% a partir de 2029.
- **Também muda em 2027:** a R-196 (art. 3º, efeitos em 01/01/2027) substitui os Anexos I a V da
  R-140. O novo Anexo I está num PDF que não abri: baixá-lo pede autorização de download. O revisor
  pode conferir em R-196, "Anexo I.pdf".
- **Status:**
  - 2026: **CONFERIDO**.
  - 2027 e 2028: **CONFERIDO na lei** (só a 6ª faixa muda). Para lojista da 6ª faixa (RBT12 acima de
    R$ 3,6 mi), o cálculo de 2027 precisa usar 18,90%. Na prática, a fase 1 não estima acima do
    sublimite (ver L10).

## L7 — Fórmula da alíquota efetiva

- **Redação:** alíquota efetiva = (RBT12 × Aliq − PD) / RBT12.
  - RBT12 é a receita bruta acumulada nos doze meses anteriores ao período de apuração.
  - Aliq é a alíquota nominal do Anexo; PD é a parcela a deduzir do Anexo.
  - Fontes: LC 123 art. 18 §1º e §1º-A (incluídos pela LC 155/2016); R-140 art. 21, II.
- **DAS do mês:** alíquota efetiva × receita bruta do mês (LC 123 art. 18 §3º; R-140 art. 22, caput).
- **RBT12 igual a zero:** para o cálculo, considera-se R$ 1,00 (R-140 art. 21, parágrafo único).
- **Segunda fonte:** a R-140 art. 21, II, repete a fórmula da lei, palavra por palavra (duas fontes
  oficiais).
- **Mudança em 2027 (R-190, efeitos em 01/01/2027):** a RBT12 passa a ser a receita dos doze meses
  **antecedentes ao mês anterior** ao período de apuração. Fica um mês de defasagem. Exemplo: para o
  DAS de março, a janela vai de fevereiro do ano anterior a janeiro.
  - Fonte: R-140 art. 21, II, "a", na redação da R-190. A R-196 não revogou essa mudança.
  - O texto compilado da LC 123 (art. 18 §1º) continua dizendo "doze meses anteriores ao do período
    de apuração".
- **Status:**
  - Fórmula: **CONFERIDO**.
  - Janela da RBT12 em 2026: **CONFERIDO** (12 meses anteriores ao mês).
  - Janela da RBT12 a partir de 2027: **CONFERIDO** (corrigido pelo revisor Opus em 24/11/2026).
    Não há conflito: a LC 214, art. 517, reescreve o art. 18 §1º e §1º-A, I da LC 123 para "doze
    meses antecedentes ao mês anterior ao do período de apuração", com efeito em 01/01/2027 (art.
    544, III, na redação da LC 227), e a R-190 (art. 21, II, "a") diz o mesmo. O texto compilado da
    LC 123 no Planalto só não incorporou a mudança.

## L8 — RBT12 de empresa com menos de 12 meses

**Regra em 2026** (R-140 art. 22 §§2º a 4º; LC 123 art. 18 §2º manda proporcionalizar):

| Momento | Receita usada como RBT12 |
|---|---|
| 1º mês de atividade | receita do próprio mês × 12 |
| 2º ao 12º mês (os 11 meses seguintes) | média aritmética da receita dos meses anteriores ao período de apuração × 12 |
| Começou no ano anterior ao da opção pelo Simples | a regra da linha acima até completar 12 meses; depois, os 12 meses anteriores normais |

**Regra a partir de 01/01/2027** (R-140 art. 22 §§2º e 4º, na redação da R-190):

| Momento | Regra |
|---|---|
| 1º e 2º mês de atividade | alíquota da **1ª faixa** do Anexo |
| 3º ao 13º mês | média aritmética da receita dos meses antecedentes ao mês anterior ao período de apuração × 12 |
| 14º mês em diante | regra geral (L7) |

- **Também muda em 2027:** a data de início de atividade passa a ser a data de inscrição no CNPJ
  (R-196).
- **Segunda fonte:** a LC 123 art. 18 §2º dá a base legal, mas não a fórmula. A fórmula só existe na
  resolução. Não há segunda fonte independente para a fórmula exata.
- **Status:**
  - 2026: **CONFERIDO**.
  - 2027: **CONFERIDO** como texto de resolução já publicada. Fica a ressalva do L7 sobre a defasagem
    de um mês.

## L9 — O que é receita bruta no Simples

- **Definição:** produto da venda de bens e serviços em conta própria, preço dos serviços, resultado
  em conta alheia e demais receitas da atividade principal.
  - **Não entram:** as **vendas canceladas** e os **descontos incondicionais concedidos**.
  - Fontes: LC 123 art. 3º §1º (redação da LC 214/2025); R-140 art. 2º, II.
- **Devolução** em mês posterior ao da venda: o valor é deduzido no **mês da devolução**. Se passar da
  receita do mês, o saldo é deduzido nos meses seguintes. No regime de caixa, deduz só o que foi
  efetivamente devolvido ao comprador. Fonte: R-140 art. 17.
- **Cancelamento** de documento fiscal em mês posterior: o valor é deduzido **no mês da tributação
  original**, não no mês do cancelamento. Fonte: R-140 art. 18.
- **Caixa ou competência:**
  - Em 2026, a empresa escolhe: competência (receita auferida) ou caixa (receita recebida). A escolha
    vale para o ano inteiro e não pode ser desfeita. Fontes: LC 123 art. 18 §3º; R-140 arts. 16 e 19.
  - **A partir de 2027, só competência.** Fonte: PSN-PGDAS, notícia oficial de 13/11/2026: a partir
    de 2027, todas as apurações serão pelo regime de competência.
  - Quem estava no caixa em 2026 inclui os valores não recebidos até 31/12/2026 na apuração de
    dezembro de 2026. Fonte: R-196, art. 144-C da R-140.
  - Devolução ou cancelamento feito em 2027 de venda tributada até 2026 é ajustado no período
    original. Fonte: R-196, art. 144-C §2º.
- **A partir de 2027, quando a receita conta:** no **faturamento**, que é a emissão do documento
  fiscal. Sem documento fiscal ou com emissão fora do prazo, conta no momento da operação. Fonte:
  R-140 art. 2º §§8º, 9º e 9º-A, na redação da R-196.
- **Segunda fonte:** LC 123 art. 3º §1º e R-140 art. 2º, II, dizem o mesmo (duas fontes oficiais).
- **Status:** **CONFERIDO**, inclusive a mudança de 2027.
- **Consequência para o app** (não é número da lei, é aviso para quem implementa):
  - O `fin_dre` lança "Estornos e devoluções" no mês da volta. Para devolução, isso bate com o
    art. 17.
  - Para cancelamento em mês posterior, o art. 18 manda deduzir no mês original. A estimativa pode
    divergir da guia nesse caso.

## L10 — Teto e sublimite do Simples

| Item | Valor | Dispositivo |
|---|---|---|
| Teto da ME | R$ 360.000,00 por ano | LC 123 art. 3º, I; R-140 art. 2º, I, "a" |
| Teto da EPP (teto do Simples) | R$ 4.800.000,00 por ano | LC 123 art. 3º, II (redação da LC 155/2016); R-140 art. 2º, I, "b" |
| Sublimite para ICMS e ISS no Simples | R$ 3.600.000,00 | LC 123 art. 13-A e art. 19 §4º |

- **Sublimite estadual opcional:** estados com até 1% do PIB podem adotar R$ 1.800.000,00 (LC 123
  art. 19). A lista muda por ano e por estado, e não foi conferida.
- **Passar do sublimite:** a empresa fica impedida de recolher ICMS e ISS pelo Simples a partir do mês
  seguinte. Se o excesso for de até 20%, só no ano seguinte (LC 123 art. 20 §§1º e 1º-A).
- **Passar do teto de R$ 4,8 mi:** exclusão no mês seguinte. Se o excesso for de até 20%, a partir do
  ano seguinte (LC 123 art. 3º §§9º e 9º-A).
- **A partir de 2027:** o sublimite de R$ 3,6 mi passa a valer também para o IBS (R-140 art. 9º, na
  redação da R-190).
- **Segunda fonte:** R-140 art. 2º, I (oficial).
- **Status:** **CONFERIDO**. No app, serve só para "acima do teto, sem estimativa". A estimativa da
  fase 1 deveria parar no sublimite de R$ 3,6 mi: acima dele, o ICMS sai do DAS e a conta muda.

## L11 — ICMS-ST e PIS/Cofins monofásico (frase "costumam pagar menos")

- **Base legal:** a empresa separa as receitas sujeitas a tributação monofásica e as de ICMS já
  recolhido por substituição tributária ou antecipação com encerramento (LC 123 art. 18 §4º-A, I).
  - Sobre essas receitas, o DAS sai com redução dos tributos já recolhidos ou sujeitos a monofásico
    (LC 123 art. 18 §12).
- **Conclusão sobre a frase:** está correta como orientação, desde que fique claro que a redução vale
  **só sobre a parte da venda** desses produtos, e **só nas parcelas** do tributo em questão:
  - ICMS, no caso de ST;
  - PIS e Cofins, no caso de monofásico.
- **Mudança em 2027:** PIS e Cofins saem da partilha do Simples e a CBS entra (LC 214, Anexo XVIII,
  ver L6). A menção a "PIS/Cofins monofásico" envelhece em 01/01/2027. Sugestão de texto que não
  envelhece: "produtos com imposto já recolhido antes (substituição tributária ou tributação
  monofásica) costumam pagar menos no DAS".
- **Segunda fonte:** só a LC 123. Não abri o art. 25 da R-140, que trata da segregação. Como é uma
  frase qualitativa e não um número, isso não decide conta.
- **Status:** **CONFERIDO** (base legal), com o ajuste de texto acima.

---

## Achados fora da tabela

1. **O teto novo do MEI tem condição:** a LC 238 art. 3º condiciona a ampliação à LOA de 2027 a 2029.
   A R-140 art. 100 ainda diz R$ 81 mil. Vale conferir a LOA 2027 e uma futura resolução do CGSN
   antes de 01/01/2027.
2. **Anexo I muda em 2027:** a 6ª faixa cai para 18,90% em 2027 e 2028 e volta a 19% em 2029. A
   partilha troca PIS e Cofins por CBS e IBS (LC 214 art. 519, Anexo XVIII).
3. **Opção pelo regime regular de IBS e CBS (2027):** quem optou paga o DAS **sem** as parcelas de
   CBS e IBS da faixa (R-140 art. 22-A, na redação da R-190). Na 1ª faixa do comércio, a CBS e o IBS
   somam cerca de 15,5% do DAS.
   - O cadastro fiscal planejado não pergunta isso. Em 2027, a estimativa de quem optou sairia cerca
     de 15% acima da guia.
   - Sugestão para a decisão de produto: pergunta extra no cadastro ou aviso fixo.
4. **Fim do regime de caixa em 2027,** e a receita passa a contar na emissão do documento fiscal
   (L9).
5. **RBT12 com um mês de defasagem a partir de 2027** (R-190) e nova regra para os primeiros meses de
   empresa nova (L7, L8).
6. **Valores fixos do MEI ganham CBS e IBS em 2027** (LC 123 Anexo VII, incluído pela LC 214
   art. 520): R$ 0,994 de CBS e R$ 0,006 de IBS (L4).
7. **Prazos das declarações (pistas do sócio):**
   - **DASN-SIMEI:** até o último dia de maio de cada ano (R-140 art. 109, redação da R-183/2025).
     **CONFERIDO.**
   - **Defis do Simples:** só a Defis do ano de 2026 existe e vence em 31/03/2027 (R-140 art. 144-F,
     incluído pela R-196). A partir dos fatos de 2027 a Defis foi REVOGADA (R-190, revogação do art.
     72 da R-140, efeito em 01/01/2027; a R-196 não desfaz). **O código NÃO pode ter vencimento anual
     recorrente de 31 de março.** (Corrigido pelo revisor Opus em 24/11/2026.)
8. **A R-196 saiu hoje,** no DOU de 24/11/2026. Ela substitui os Anexos I a V da R-140 a partir de
   01/01/2027, em PDF que não abri. Qualquer número de 2027 que dependa da resolução deve ser
   reconferido nesse PDF.
9. **Vencimento depende de expediente bancário,** não só de feriado nacional (R-140 art. 40 §3º).
   Existe prorrogação por calamidade (art. 40-A).

---

## O que o código pode usar hoje (só CONFERIDO)

- Teto anual do MEI **2026** → R$ 81.000,00 (L1)
- Teto proporcional do MEI no ano de abertura **2026** → R$ 6.750,00 × meses, fração de mês = mês
  inteiro (L2)
- Faixas do excesso do MEI → até 20% acima: efeito em 1º de janeiro do ano seguinte; acima de 20%:
  retroativo a 1º de janeiro do ano do excesso, ou ao início da atividade no ano de abertura (L3)
- DAS-MEI **2026** → comércio/indústria R$ 82,05; serviço R$ 86,05; comércio + serviço R$ 87,05 (L4)
- Vencimento do DAS (MEI e Simples) → dia 20 do mês seguinte; sem expediente bancário, dia útil
  seguinte (L5)
- Anexo I **2026** → 4,00%/0; 7,30%/5.940; 9,50%/13.860; 10,70%/22.500; 14,30%/87.300;
  19,00%/378.000 (L6)
- Alíquota efetiva → (RBT12 × Aliq − PD) / RBT12; RBT12 = 12 meses anteriores ao mês (2026); RBT12
  zero = R$ 1,00 (L7)
- RBT12 de empresa nova em **2026** → 1º mês: receita do mês × 12; do 2º ao 12º: média dos meses
  anteriores × 12 (L8)
- Receita bruta → sem vendas canceladas e sem descontos incondicionais; devolução deduz no mês da
  devolução; cancelamento deduz no mês original (L9)
- Teto do Simples R$ 4.800.000,00; sublimite de ICMS/ISS R$ 3.600.000,00 (L10)
- Frase ST/monofásico → base legal conferida; usar o texto que não envelhece (L11)
- DASN-SIMEI até o último dia de maio (achado 7). Defis: só a de 2026, até 31/03/2027, sem recorrência
  (achado 7).
- Janela da RBT12 a partir de 2027: 12 meses antecedentes ao mês anterior ao da apuração (L7,
  LC 214 art. 517).
- **Ressalva de receita bruta (L9, para quem implementa):** a R-140 art. 2º §4º, I (2026) já inclui na
  receita bruta o custo do financiamento nas vendas a prazo (juros de parcelamento cobrados do
  comprador). Em 2027 a R-196 acrescenta o §4º, V (juros de mora, multas e demais valores cobrados
  na operação). Para 2026 a fonte certa do texto de L9 é a R-140 art. 2º, II.

## O que fica fora do código (NÃO CONFERIDO, CONFLITANTE ou condicional)

- **Teto do MEI 2027 (R$ 110 mil) e 2028+ (R$ 140 mil); teto proporcional 2027 (R$ 9.166,67) e 2028+
  (R$ 11.666,67):** estão na lei, mas dependem da LOA (LC 238 art. 3º) e o CGSN não regulamentou.
  - Sugestão: o módulo guarda esses valores com a marca "condicional". A tela mostra "valores de 2027
    ainda não confirmados" até alguém reconferir a LOA 2027 e a R-140 art. 100.
- **DAS-MEI 2027:** NÃO CONFERIDO. Falta o salário mínimo de 2027, e a composição muda com CBS e IBS.
- **Anexo I de 2027 pela R-196** (PDF não aberto): o da lei está conferido (6ª faixa 18,90%), mas a
  tabela da resolução ainda tem de ser reconferida.
- **Estimativa de 2027 para quem optou pelo regime regular de IBS e CBS:** sem dado no cadastro;
  depende de decisão de produto (achado 3).
- **Sublimite estadual de R$ 1,8 mi:** não conferido por estado.
