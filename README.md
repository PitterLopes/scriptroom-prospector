# Prospector — prospecção autônoma no Instagram

Um sistema que roda no seu computador e faz, sozinho, o trabalho de um SDR no Instagram: encontra perfis do seu
público, lê os posts recentes de cada um, pontua, escreve uma primeira mensagem honesta e pessoal (elogiando um
post real), segue a pessoa, manda a DM pelo seu próprio Chrome num ritmo humano, e continua a conversa pela API
oficial da Meta quando a pessoa responde — com um painel para você acompanhar tudo.

Foi construído para o [Scriptroom](https://scriptroom.online) e depois reaproveitado, sem mudar código, para a
[DropDesk](https://lpdropdesk.com.br): **o sistema não sabe de produto nenhum**. Tudo o que é do seu negócio mora
em um arquivo de configuração. Para prospectar para a sua empresa, você preenche esse arquivo e as chaves.

> O manual completo, em português, está em **[SETUP.md](./SETUP.md)**. A arquitetura, em inglês, está em
> [docs/architecture.md](./docs/architecture.md).

## O que você precisa

- Um Mac, Windows ou Linux com **Node.js 22** e **Google Chrome**.
- Uma conta do Instagram **profissional** (Business ou Creator) do seu negócio. É ela que manda as mensagens.
  Leia a seção de risco do SETUP: automação de navegador contraria os termos do Instagram, e a conta pode ser
  restringida. Comece com poucas mensagens por dia.
- Uma conta na [OpenRouter](https://openrouter.ai) (é quem roda a IA; custa centavos por conversa).
- Uma conta de desenvolvedor na [Meta for Developers](https://developers.facebook.com) (grátis), para a API de
  mensagens, e uma conta na [Cloudflare](https://cloudflare.com) (grátis), para a caixa de entrada dos webhooks.

## Passo a passo

1. **Baixe e instale.**
   ```bash
   git clone https://github.com/PitterLopes/scriptroom-prospector.git prospector
   cd prospector
   npm install
   cp .env.example .env
   cp config/business.example.json config/business.json
   ```
2. **Descreva o seu negócio** em `config/business.json`: quem escreve, o que o produto faz, a história que a
   primeira mensagem conta, **só os fatos que você pode provar** (a IA não afirma nada fora dessa lista), quem é o
   público, hashtags e palavras-chave de onde ele posta, e quem não interessa. Troque todos os `{{...}}`; o
   sistema se recusa a ligar enquanto houver um.
3. **A chave da OpenRouter**: crie uma chave com limite de gasto (US$ 20 é bastante) e coloque em
   `OPENROUTER_API_KEY` no `.env`.
4. **O Chrome dedicado**: rode `scripts/chrome-debug.sh` (no Windows, `scripts/chrome-debug.ps1`). Abre um Chrome
   separado do seu; faça login no Instagram do negócio nessa janela e deixe-a aberta.
5. **A API da Meta** (para a conversa continuar depois da primeira resposta): siga a seção 5 do SETUP — um app no
   Meta for Developers com o caso de uso Instagram, a caixa de entrada na Cloudflare (`relay/`), o token da conta.
   Dá para pular este passo no começo: sem ele, a primeira mensagem sai, mas as respostas você lê e responde à mão
   no Instagram.
6. **Rode:**
   ```bash
   npm run dev
   ```
   Painel em http://localhost:3100. O sistema nasce em **modo simulação**: faz tudo, digita a mensagem na caixa e
   apaga sem enviar. Veja no painel os leads, as pontuações e as mensagens simuladas; ajuste a configuração até
   gostar do que lê.
7. **Ligue o envio real** só quando estiver satisfeito: `BROWSER_SEND_ENABLED=true` no `.env`, reinicie, e clique
   em "Ligar envio real" no painel. Comece com 5 mensagens por dia (`MAX_DMS_PER_DAY`).

## O que ele faz para não queimar a sua conta

- Ritmo humano: pausas entre páginas, digitação com cadência, no máximo N mensagens por dia, horário comercial.
- Segue a pessoa e elogia um post real antes de pedir qualquer coisa; a mensagem diz quem você é e o que quer.
- Disjuntores: três falhas de envio numa hora, três pedidos de "pare" num dia, qualquer sinal de restrição do
  Instagram ou mensagem duplicada param tudo até você olhar.
- Uma pessoa que disse "não" nunca é contatada de novo. Um follow-up só, e silêncio depois dele encerra.
- Verificador de afirmações: nada de superlativo, garantia, preço não confirmado ou link fora da lista sai da IA.
  O que ela não pode responder vai para você, no painel.

## Para desenvolvedores

Next.js + React, TypeScript, SQLite (Drizzle), Playwright sobre o Chrome do operador (CDP), OpenRouter, Cloudflare
Worker para os webhooks. `npm run check` roda lint, tipos e testes; `npm run simulate` roda o fluxo inteiro com
Instagram, IA e API falsos. Detalhes em [docs/architecture.md](./docs/architecture.md).

## Licença e responsabilidade

Use por sua conta e risco, com a sua própria conta e as suas próprias chaves. O sistema é honesto por desenho —
diz quem é, o que quer, e aceita um "não" — mas quem assina cada mensagem é você.
