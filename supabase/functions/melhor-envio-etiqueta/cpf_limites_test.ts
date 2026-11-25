// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) em `cpf.ts` — o módulo que guarda o CPF da
 * cliente (dado pessoal) e decide o que pode ir para log e para o painel.
 * Depois de `index_test.ts`, ainda sobreviviam defeitos de UMA linha:
 *
 *   * dígito verificador: o caso em que o resto da conta dá 10 (e o dígito vira
 *     0) nunca era exercitado — trocar 0 por 1, ou nunca converter, passava;
 *   * `&&` entre os dois dígitos: bastava UM certo para aceitar;
 *   * CPF que chega como NÚMERO (perde o zero à esquerda e deve ser recusado);
 *   * a lista FECHADA de campos do carrinho: só 'insurance_value' e poucos
 *     nomes eram exercitados, e o limite do índice de lista (1 a 3 dígitos)
 *     não era medido;
 *   * telefone com `+`, com 13 dígitos, fixo com prefixo de 4 dígitos, e
 *     e-mail dentro de JSON (aspas não podem entrar no endereço).
 *
 * Tudo com valores inventados; sem rede, sem banco.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import {
    camposRecusadosDoProvedor,
    cpfDoDestinatario,
    cpfValido,
    sanitizarCpfDoTexto,
    sanitizarDadosPessoaisDoTexto,
} from "./cpf.ts"

// ── dígito verificador ────────────────────────────────────────────────────

Deno.test("cpfValido - resto 10 vira dígito 0, e é o dígito certo (1º e 2º dígito)", () => {
    // 1º dígito sai de resto 10; 2º dígito normal
    assertEquals(cpfValido("10000000108"), true)
    assertEquals(cpfValido("10000001503"), true)
    // 2º dígito sai de resto 10
    assertEquals(cpfValido("10000002810"), true)
    assertEquals(cpfValido("10000003620"), true)
    // controle: dígito 0 que veio de resto 0, não de 10
    assertEquals(cpfValido("10000000604"), true)
    assertEquals(cpfValido("10000002305"), true)
    assertEquals(cpfValido("10000000280"), true)
    assertEquals(cpfValido("10000001090"), true)
    // o dígito vizinho não vale no lugar do 0
    assertEquals(cpfValido("10000000118"), false)
    assertEquals(cpfValido("10000002811"), false)
    assertEquals(cpfValido("10000000100"), false)
})

Deno.test("cpfValido - os DOIS dígitos têm de bater: só o 1º certo ou só o 2º certo é recusado", () => {
    assertEquals(cpfValido("52998224725"), true)
    assertEquals(cpfValido("52998224720"), false) // 1º certo, 2º errado
    assertEquals(cpfValido("52998224755"), false) // 1º errado, 2º certo
    assertEquals(cpfValido("52998224700"), false) // os dois errados
})

Deno.test("cpfValido - número aceito só quando mantém os 11 dígitos; zero à esquerda perdido é recusado; outros tipos recusados", () => {
    assertEquals(cpfValido(52998224725), true)
    assertEquals(cpfValido("01234567890"), true)
    // 01234567890 como número vira 1234567890 (10 dígitos): não é CPF
    assertEquals(cpfValido(1234567890), false)
    assertEquals(cpfValido(Number("01234567890")), false)
    assertEquals(cpfValido(true), false)
    assertEquals(cpfValido(["52998224725"]), false)
    assertEquals(cpfValido({ toString: () => "52998224725" }), false)
    assertEquals(cpfValido(52998224725n), false)
})

Deno.test("cpfDoDestinatario - número é aceito e vira texto de 11 dígitos; espaços e máscara saem; tipo estranho vira null", () => {
    assertEquals(cpfDoDestinatario({ cpf: 52998224725 }), "52998224725")
    assertEquals(cpfDoDestinatario({ cpf: " 529.982.247-25 " }), "52998224725")
    assertEquals(cpfDoDestinatario({ cpf: "01234567890" }), "01234567890")
    assertEquals(cpfDoDestinatario({ cpf: 1234567890 }), null)
    assertEquals(cpfDoDestinatario({ cpf: ["52998224725"] }), null)
    assertEquals(cpfDoDestinatario({ cpf: { valor: "52998224725" } }), null)
    assertEquals(cpfDoDestinatario({ cpf: true }), null)
    assertEquals(cpfDoDestinatario({ cpf: "52998224720" }), null)
})

// ── texto: CPF, e-mail e telefone saem do log ────────────────────────────

Deno.test("sanitizarCpfDoTexto - máscara exige os pontos e o traço de verdade; 12 dígitos seguidos não são CPF", () => {
    assertEquals(sanitizarCpfDoTexto("cpf 529.982.247-25 fim"), "cpf [cpf] fim")
    assertEquals(sanitizarCpfDoTexto("123a456b789-01"), "123a456b789-01")
    assertEquals(sanitizarCpfDoTexto("529.982.24725"), "529.982.24725")
    assertEquals(sanitizarCpfDoTexto("protocolo 123456789012"), "protocolo 123456789012")
    assertEquals(sanitizarCpfDoTexto("1234567890"), "1234567890")
    // CPF cru colado nas bordas do texto
    assertEquals(sanitizarCpfDoTexto("52998224725"), "[cpf]")
    assertEquals(sanitizarCpfDoTexto("a 52998224725"), "a [cpf]")
    // os dois formatos no mesmo texto
    assertEquals(sanitizarCpfDoTexto("529.982.247-25 e 52998224725"), "[cpf] e [cpf]")
})

Deno.test("sanitizarDadosPessoaisDoTexto - telefone com +55 e com 13 dígitos some por inteiro (nenhum resto de dígito)", () => {
    assertEquals(sanitizarDadosPessoaisDoTexto("+5534998765432"), "[telefone]")
    assertEquals(sanitizarDadosPessoaisDoTexto("fone 5534998765432."), "fone [telefone].")
    assertEquals(sanitizarDadosPessoaisDoTexto("5511900000000"), "[telefone]")
    assertEquals(sanitizarDadosPessoaisDoTexto("+5511900000000 ok"), "[telefone] ok")
})

Deno.test("sanitizarDadosPessoaisDoTexto - fixo formatado (prefixo de 4 dígitos) e celular formatado somem; CEP e número de pedido ficam", () => {
    assertEquals(sanitizarDadosPessoaisDoTexto("ligue (34) 3210-5678 hoje"), "ligue [telefone] hoje")
    assertEquals(sanitizarDadosPessoaisDoTexto("ligue (11) 90000-0000 hoje"), "ligue [telefone] hoje")
    assertEquals(sanitizarDadosPessoaisDoTexto("ligue 34 3210-5678"), "ligue [telefone]")
    assertEquals(sanitizarDadosPessoaisDoTexto("ligue 11 90000-0000"), "ligue [telefone]")
    assertEquals(sanitizarDadosPessoaisDoTexto("CEP 38500000 e CEP 38500-000"), "CEP 38500000 e CEP 38500-000")
    assertEquals(sanitizarDadosPessoaisDoTexto("pedido 123456789"), "pedido 123456789")
})

Deno.test("sanitizarDadosPessoaisDoTexto - e-mail dentro de JSON some sem levar as aspas nem os campos vizinhos", () => {
    assertEquals(
        sanitizarDadosPessoaisDoTexto('{"email":"joao@fixture.invalid","campo":1}'),
        '{"email":"[email]","campo":1}',
    )
    assertEquals(
        sanitizarDadosPessoaisDoTexto("de <joao@fixture.invalid>, para (ana@fixture.invalid); fim"),
        "de <[email]>, para ([email]); fim",
    )
    assertEquals(sanitizarDadosPessoaisDoTexto("sem arroba aqui"), "sem arroba aqui")
})

Deno.test("sanitizar* - entrada que não é texto volta como veio (nunca explode no caminho do log)", () => {
    assertEquals(sanitizarCpfDoTexto(undefined), undefined)
    assertEquals(sanitizarCpfDoTexto(null), null)
    assertEquals(sanitizarCpfDoTexto(52998224725), 52998224725)
    assertEquals(sanitizarDadosPessoaisDoTexto(undefined), undefined)
    assertEquals(sanitizarDadosPessoaisDoTexto(null), null)
    assertEquals(sanitizarDadosPessoaisDoTexto(5534998765432), 5534998765432)
})

// ── campos recusados pelo provedor ────────────────────────────────────────

const erros = (...chaves: string[]) =>
    JSON.stringify({ errors: Object.fromEntries(chaves.map((c) => [c, ["x"]])) })

Deno.test("camposRecusadosDoProvedor - CADA nome da lista fechada do carrinho é aceito, em qualquer posição do caminho", () => {
    const nomes = [
        "service", "from", "to", "products", "volumes", "options",
        "name", "phone", "email", "document", "company_document", "state_register",
        "address", "complement", "number", "district", "city", "state_abbr", "country_id", "postal_code",
        "quantity", "unitary_value", "weight", "width", "height", "length",
        "insurance_value", "receipt", "own_hand", "reverse", "non_commercial",
    ]
    for (const nome of nomes) {
        assertEquals(camposRecusadosDoProvedor(erros(`${nome}.${nome}`)), [`${nome}.${nome}`], nome)
    }
})

Deno.test("camposRecusadosDoProvedor - nome fora da lista, com caixa diferente ou segmento vazio não passa", () => {
    for (const chave of [
        "to.name_x", "to.NAME", "to.", ".to", "to..name", "to.postal-code", "to.cpf", "token", "to.name ",
        "volumes.-1.weight", "volumes.1a.weight", "volumes.1000.weight", "volumes..weight",
    ]) {
        assertEquals(camposRecusadosDoProvedor(erros(chave)), [], chave)
    }
})

Deno.test("camposRecusadosDoProvedor - índice de lista tem de 1 a 3 dígitos (0, 12 e 999 passam; 1000 não)", () => {
    assertEquals(camposRecusadosDoProvedor(erros("volumes.0.weight")), ["volumes.0.weight"])
    assertEquals(camposRecusadosDoProvedor(erros("volumes.12.weight")), ["volumes.12.weight"])
    assertEquals(camposRecusadosDoProvedor(erros("volumes.999.weight")), ["volumes.999.weight"])
    assertEquals(camposRecusadosDoProvedor(erros("volumes.1000.weight")), [])
})

Deno.test("camposRecusadosDoProvedor - `errors` que não é objeto simples (lista, texto, número, nulo) dá lista vazia", () => {
    for (const corpo of [
        JSON.stringify({ errors: ["to.name"] }),
        JSON.stringify({ errors: "to.name" }),
        JSON.stringify({ errors: 1 }),
        JSON.stringify({ errors: null }),
        JSON.stringify({ errors: true }),
        JSON.stringify({}),
        JSON.stringify(null),
        JSON.stringify(["to.name"]),
        JSON.stringify("to.name"),
    ]) {
        assertEquals(camposRecusadosDoProvedor(corpo), [], corpo)
    }
})

Deno.test("camposRecusadosDoProvedor - chave estranha não gasta o limite de 6: os 6 primeiros CONHECIDOS entram, na ordem do corpo", () => {
    const corpo = erros(
        "estranha.a", "estranha.b", "estranha.c",
        "to.name", "to.phone", "to.email", "to.document", "to.city", "to.state_abbr", "to.postal_code",
    )
    assertEquals(camposRecusadosDoProvedor(corpo), [
        "to.name", "to.phone", "to.email", "to.document", "to.city", "to.state_abbr",
    ])
})
