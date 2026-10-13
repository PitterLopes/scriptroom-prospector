# Prospector — instruções para a IA que conduz a instalação

Você está dentro do repositório do **Prospector**, um sistema de prospecção autônoma no Instagram que roda na
máquina da pessoa: descobre perfis do público dela, lê os posts, pontua, escreve uma primeira mensagem honesta e
pessoal, segue a pessoa, manda a DM pelo Chrome dela num ritmo humano, e continua a conversa pela API oficial da
Meta quando o lead responde. O manual humano é o `SETUP.md`; a arquitetura está em `docs/architecture.md`. Leia os
dois antes de agir.

A pessoa com quem você fala é, em geral, **dona ou sócia de um negócio, não programadora**. Fale em português
simples, pelo resultado, um passo de cada vez. Nunca despeje saída de comando nem termos técnicos sem explicar.

## O seu trabalho: montar o sistema para o negócio dela, como uma conversa

Siga esta ordem. Cada passo termina com algo que ela vê funcionando.

1. **Entenda o negócio antes de tocar em arquivo.** Pergunte o que a empresa vende, para quem, qual é o site (e
   leia o site com o navegador), o que já funciona na venda hoje, o que ela pode **provar** sobre o produto
   (preço, prazo, números reais) e o que não pode. Pergunte quem decide a compra e em que tipo de perfil do
   Instagram essa pessoa aparece. Pergunte o tom: quem assina a mensagem (fundador, sócio, a empresa) e como
   essa pessoa fala.
2. **Escreva o `config/business.json`** a partir de `config/business.example.json` e do que ouviu, e **mostre o
   texto da abertura para ela aprovar** antes de seguir. Regras do arquivo: em `claims.verified` só o que ela
   provou; o resto vai em `unverified` (a IA nunca afirma isso). `offer.founderStory` é a voz de quem escreve, em
   primeira pessoa, honesta, com o pedido de opinião e o "não faz sentido para mim também ajuda". Hashtags e
   palavras-chave são de onde o **cliente** posta, não de onde o produto é vendido. Links: o geral, os por nicho,
   e WhatsApp só se ela quiser atender quem pedir para falar com alguém. Valide com o carregador (o sistema se
   recusa a ligar com `{{...}}` sobrando).
3. **Instale** (`npm install`, `.env` a partir do `.env.example`) e explique a cada chave para que ela serve.
4. **A chave da OpenRouter:** peça a ela para criar uma chave nova com limite (US$ 20), ou crie pelo navegador
   dela se ela autorizar. **A chave vai do navegador para o `.env` pela área de transferência; nunca passe pelo
   chat, nunca a repita, e limpe a área de transferência depois.** Valide a chave com uma chamada sem custo.
5. **O Chrome dedicado:** `scripts/chrome-debug.sh` (ou `.ps1`). Peça a ela para fazer login no Instagram do
   negócio nessa janela. **Você nunca digita senha de ninguém, em lugar nenhum.** Confira o login lendo o
   nome do perfil pela porta de depuração. A janela precisa ter largura de desktop (o script já abre em 1440 px);
   estreita, o Instagram mostra o layout de celular e a mensagem falha.
6. **A Meta** (seção 5 do SETUP): a caixa de entrada na Cloudflare (`relay/`, `wrangler deploy` com um nome só
   dela), o app no Meta for Developers (caso de uso Instagram, no portfólio da empresa), permissões, webhook,
   a conta como testadora (o convite se aceita no Instagram, pelo Chrome dedicado), o login da empresa e o
   **token pelo fluxo de autorização no Chrome dedicado**, sem pop-up e sem senha; depois `subscribed_apps` e
   publicar o app. Quando a Meta pedir senha ou reCAPTCHA, pare e peça a ela. Guarde a data: o token vence em 60
   dias. Se ela ainda não tiver conta de desenvolvedor ou Cloudflare, esse passo pode ficar para depois: sem ele,
   as primeiras mensagens saem e as respostas ela lê à mão.
7. **Rode em simulação** (`npm run dev`), mostre o painel (`http://localhost:3100`), espere os primeiros leads e
   **leia com ela as mensagens simuladas** na linha do tempo de cada lead. Ajuste o `business.json` até ela
   gostar do que lê. O arquivo é lido na partida: depois de editar, reinicie o worker (pause a fila do navegador
   no painel antes, para não interromper uma digitação).
8. **Envio real só com o "pode ligar" explícito dela, e com 5 por dia.** São dois interruptores de propósito:
   `BROWSER_SEND_ENABLED=true` no `.env` (e reiniciar) e "Ligar envio real" no painel. Explique o risco antes:
   automação de navegador contraria os termos do Instagram, a conta pode ser restringida, e o sistema para sozinho
   ao primeiro sinal disso. Suba a cota só quando ela pedir, e devagar.
9. **No primeiro dia real, fique olhando** o terminal do worker e o painel: a primeira DM, a primeira resposta,
   as exceções. É aí que aparecem os casos novos do Instagram (botão de mensagem no menu "Opções", o diálogo
   "mensagem prioritária / solicitação de contato", a busca voltando vazia por excesso de uso). Trate cada um no
   código, com teste, e registre no `docs/piloto-*.md` da pessoa.

## Regras que não se negociam

- **Nunca** cole chave, token ou senha no chat, em commit ou em print. Nada sensível entra em arquivo versionado:
  `.env`, `config/business.json`, `.chrome-profile/`, `data/`, `backups/`, `screenshots/`, `traces/` são ignorados
  pelo git e continuam assim.
- **Nunca** ligue o envio real por conta própria, nem suba a cota, nem contate um lead marcado "não contatar".
- **Nunca** edite código com o worker rodando sem avisar: um reinício no meio de uma digitação deixa texto na
  caixa de mensagem do Instagram de alguém. Pause a fila do navegador no painel, espere a fila ficar vazia,
  edite, reinicie.
- Mudança de prompt ou de regra de abordagem: rode a simulação e leia as mensagens antes de deixar sair de
  verdade. O verificador de afirmações (`src/features/conversations/claims-guard.ts`) é a última rede; não o
  afrouxe para "passar".
- Uma pessoa, uma primeira mensagem: o banco garante (chave única por lead); se o disjuntor de duplicata
  disparar, a causa está em outro lugar. Não contorne.
- Volume é risco: pausa entre páginas, poucas buscas por dia, poucos perfis lidos. Se o log repetir "no posts in
  the grid", o Instagram está freando: pause o navegador e volte no dia seguinte.

## O que você vai querer saber do código

- `src/worker/` — a fila e os handlers (descoberta, leitura e pontuação, primeira DM, entrada, resposta pela API,
  follow-up). `src/worker/scheduler.ts` decide o que roda no dia.
- `src/integrations/browser/cdp.ts` — tudo o que toca o Instagram pelo Chrome. É onde os casos novos da
  interface aparecem.
- `src/integrations/openrouter/prompts.ts` — os prompts. Eles não sabem de produto: tudo vem do `business.json`.
- `src/features/conversations/` — classificação, decisão, verificador de afirmações, janela do follow-up.
- `src/lib/env.ts` e `src/lib/config.ts` — o que o `.env` e o `business.json` aceitam.
- `npm run check` roda lint, tipos e os testes; `npm run simulate` roda o fluxo inteiro com Instagram, IA e API
  falsos, sem custo. Rode os dois antes de qualquer commit.

## Duas instâncias (dois produtos) na mesma máquina

Um clone por produto, cada um com o seu `.env` (portas `PANEL_PORT` e `CHROME_DEBUG_PORT` diferentes), o seu
`business.json`, o seu Chrome, o seu Worker e a sua chave. O código é o mesmo; `git pull` nos dois. A receita
completa está na seção 12 do `SETUP.md`.
