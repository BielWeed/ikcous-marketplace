// LICENSEs MIT verificados no upstream para versões que não os incluem no npm.
// Os três textos têm os mesmos termos MIT; só a linha de copyright difere.
const mit = (copyright) => `MIT License

${copyright}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const radix = {
  fonte:
    "https://github.com/radix-ui/primitives/blob/fcef0668a5c827e5a4baac405474d75680f9a4eb/LICENSE",
  texto: mit("Copyright (c) 2022 WorkOS"),
};

const embla = {
  fonte: "https://github.com/davidjerleke/embla-carousel/blob/v8.6.0/LICENSE",
  texto: mit("Copyright (c) David Jerleke."),
};

const scrollBar = {
  fonte:
    "https://github.com/theKashey/react-remove-scroll-bar/blob/7301c160fda44cb8cf2b9fdfde61efad35736196/LICENSE",
  texto: mit("Copyright (c) 2025 Anton Korzunov <thekashey@gmail.com>"),
  ressalva:
    "Texto copiado do repositório upstream, não vem no pacote npm. Não foi possível confirmar o LICENSE da versão exata: a publicação npm é de 15/12/2024 e o primeiro LICENSE no histórico upstream é de 21/05/2025.",
};

export const licencasVerificadas = new Map([
  ["@radix-ui/number@1.1.1", radix],
  ["@radix-ui/react-compose-refs@1.1.2", radix],
  ["@radix-ui/react-context@1.1.2", radix],
  ["@radix-ui/react-direction@1.1.1", radix],
  ["@radix-ui/react-id@1.1.1", radix],
  ["@radix-ui/react-use-callback-ref@1.1.1", radix],
  ["@radix-ui/react-use-escape-keydown@1.1.1", radix],
  ["@radix-ui/react-use-layout-effect@1.1.1", radix],
  ["@radix-ui/react-use-previous@1.1.1", radix],
  ["@radix-ui/react-use-size@1.1.1", radix],
  ["embla-carousel-react@8.6.0", embla],
  ["embla-carousel-reactive-utils@8.6.0", embla],
  ["embla-carousel@8.6.0", embla],
  ["react-remove-scroll-bar@2.3.8", scrollBar],
]);
