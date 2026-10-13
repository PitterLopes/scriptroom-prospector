# Prospector — manual do operador

Este sistema prospecta pessoas no Instagram para o seu negócio: descobre perfis, pontua, manda uma primeira
mensagem pessoal pelo **seu** Chrome, e continua a conversa pela **API oficial da Meta** quando a pessoa responde.
Ele roda só na sua máquina. Nada sobe para servidor nenhum além da OpenRouter (a IA), da Meta (a API) e da sua
caixa de entrada na Cloudflare (os webhooks). O que é do seu negócio mora em `config/business.json`; o resto do
código não sabe de produto nenhum.

**Antes de começar, o aviso honesto:** mandar DM automatizada pela interface do Instagram vai contra os termos de
uso da Meta. O sistema imita o ritmo de uma pessoa e para sozinho ao primeiro sinal de restrição, mas a conta usada
pode ser limitada ou bloqueada. Por isso ele nasce em **modo simulação**: nada é enviado até
você ligar o envio real em dois lugares, de propósito.

---

## 1. O que você precisa

- macOS, Linux ou Windows com **Node.js 22 ou mais novo** (`node -v`).
- **Google Chrome** instalado.
- Uma conta **Business ou Creator** no Instagram, do seu negócio. É ela que manda as mensagens.
- Uma chave da **OpenRouter** só para este projeto (passo 3).
- Para a continuação pela API: um app no **Meta for Developers** com o produto Instagram (passo 5).

## 2. Instalar

```bash
cd ~/scriptroom-prospector
npm install
cp .env.example .env
```

O arquivo `config/business.json` já está preenchido com os dados do Scriptroom (empresa, pitch, afirmações
permitidas e bloqueadas, segmentos, palavras-chave). É **o único lugar** com dados reais do negócio. Para mudar
uma afirmação ou um segmento, edite esse arquivo e reinicie o worker.

## 3. A chave da OpenRouter

1. Entre em https://openrouter.ai/settings/keys e crie uma chave **nova, só para este projeto** (dê o nome
   "Scriptroom Prospector"). Defina um **limite de crédito** na própria chave (US$ 20 é um bom começo).
2. Cole no `.env`, na linha `OPENROUTER_API_KEY=`. Nunca cole a chave no chat, em print ou em commit.
3. `OPENROUTER_MONTHLY_BUDGET_USD=20` é o teto do mês: ao chegar lá o sistema **pausa sozinho**.

Por que uma chave separada: o custo deste projeto aparece separado no painel da OpenRouter, e se ela vazar você
revoga só ela, sem mexer em mais nada.

**Quais modelos de IA ele usa, e por quê.** São dois, definidos no `.env` e já preenchidos no `.env.example`:

- `OPENROUTER_MODEL=deepseek/deepseek-v4-pro-0813` — escreve a primeira mensagem e decide cada resposta da
  conversa. Foi escolhido porque escreve bem em português, obedece a estrutura pedida (elogio real, quem escreve,
  pedido, o "não" também ajuda) e custa centavos: uma abertura sai por menos de US$ 0,01.
- `OPENROUTER_MODEL_FAST=deepseek/deepseek-v4.1-flash` — classifica a intenção de cada resposta recebida
  (interessado, pediu preço, não é quem decide, pediu para parar…). Tarefa simples, modelo barato e rápido.

Com 10 mensagens por dia e as conversas que elas geram, o gasto fica na casa de **US$ 1 a 3 por mês**. O teto
`OPENROUTER_MONTHLY_BUDGET_USD` pausa o sistema se passar. O raciocínio ("thinking") dos modelos fica desligado de
propósito: ligado, o DeepSeek estoura o tamanho da resposta e fica lento.

Dá para trocar qualquer um dos dois por outro modelo da OpenRouter só mudando a linha no `.env` (por exemplo
`anthropic/claude-sonnet-5-5` para a escrita, mais caro e um pouco melhor em nuance). O que não muda: o
verificador de afirmações roda sobre o texto de qualquer modelo, então um modelo "criativo demais" só gera mais
recusas e revisões humanas, não mensagens erradas. Se trocar, rode uma semana em simulação e leia as mensagens
no painel antes de ligar o envio real.

## 4. O Chrome com perfil dedicado (primeiro contato)

A API da Meta não deixa abrir conversa com quem nunca respondeu. A primeira mensagem sai pelo seu Chrome,
numa **janela separada**, com um **perfil separado** do seu pessoal (o Chrome 136+ exige isso para abrir a porta
de depuração).

macOS / Linux:

```bash
./scripts/chrome-debug.sh
```

Windows (PowerShell):

```powershell
.\scripts\chrome-debug.ps1
```

O script abre o Chrome com o perfil em `.chrome-profile/` e a porta de depuração em `127.0.0.1:9222`. Na janela
que abrir, **entre no Instagram uma vez** com a conta de prospecção. Deixe essa janela aberta enquanto o worker
roda; pode minimizar. O sistema abre a própria aba, digita e fecha a aba; nunca toma o seu mouse nem o teclado.

> **Segurança:** a porta de depuração dá controle total sobre essa sessão logada. Ela fica em `127.0.0.1`,
> nunca em `0.0.0.0`, e nunca numa máquina compartilhada. Se o Chrome não estiver aberto, o sistema **não** abre
> outro: registra "Chrome indisponível" e pausa a fila do navegador.

## 5. A API oficial da Meta (continuação da conversa)

Esta parte é opcional para testar o resto, mas sem ela toda resposta de lead vai para "Precisa de você" no painel,
e você responde à mão. Com ela, a IA responde sozinha dentro das regras. Leva uma hora, e a maior parte é clicar
no Meta for Developers. Nada aqui pede a sua senha a ninguém: quem loga é você, no seu navegador.

1. **A caixa de entrada na Cloudflare** (pasta `relay/`): a Meta exige uma URL pública para entregar as mensagens,
   e esta é um Worker pequeno que as guarda até o seu computador buscar (funciona com o computador desligado; os
   eventos esperam até 14 dias). Com uma conta na Cloudflare: `cd relay && npm install && npx wrangler login &&
   npx wrangler deploy --name <um-nome-seu>-inbox`. Gere dois segredos longos e grave-os no Worker e no `.env`:
   `npx wrangler secret put VERIFY_TOKEN` (= `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` no `.env`) e
   `npx wrangler secret put RELAY_TOKEN` (= `RELAY_TOKEN`). `RELAY_URL` no `.env` é a URL que o deploy imprimiu.
   O terceiro segredo, `APP_SECRET`, vem do passo 3.
2. **O app no Meta for Developers:** "Criar app", caso de uso **"Gerenciar mensagens e conteúdo no Instagram"**,
   conectado ao portfólio empresarial do seu negócio (se o portfólio já tiver a verificação da empresa, melhor:
   é ela que libera o uso para valer). Na página do caso de uso, aba "Configuração da API com login do Instagram":
   **"Add all required permissions"** (`instagram_business_basic`, `instagram_business_manage_comments`,
   `instagram_business_manage_messages`).
3. **A chave secreta** ("Chave secreta do app do Instagram" › Mostrar): copie para `INSTAGRAM_APP_SECRET` no `.env`
   e para o Worker (`npx wrangler secret put APP_SECRET` dentro de `relay/`). É com ela que o Worker confere que
   cada mensagem veio mesmo da Meta.
4. **O webhook:** na seção "3. Configurar webhooks", URL de callback `<RELAY_URL>/webhook` e o verify token do
   passo 1; "Verificar e salvar". A Meta assina vários campos; só `messages` importa, o resto é ignorado.
5. **A conta como testadora:** em "Funções do app" › "Adicionar pessoas" › **Testador do Instagram**, o @ do seu
   negócio. O convite é aceito **no Instagram**, logado na conta do negócio (o Chrome dedicado do passo 4 serve):
   Configurações › Apps e sites › Convites de testador › Aceitar.
6. **O login da empresa:** na seção "4. Configurar o login da empresa no Instagram" › Configurar, URL de
   redirecionamento `<RELAY_URL>/oauth`. Salvar.
7. **O token, sem pop-up e sem senha.** Abra, no Chrome dedicado (já logado na conta do negócio), esta URL, trocando
   `<ID>` pelo "ID do app do Instagram" da página do caso de uso:
   `https://www.instagram.com/oauth/authorize?client_id=<ID>&redirect_uri=<RELAY_URL>/oauth&response_type=code&scope=instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments`
   Clique em "Permitir". A página de volta (um 404 do Worker, normal) tem `?code=...` no endereço: esse código vale
   uma vez e troca-se por um token de curta duração em `POST https://api.instagram.com/oauth/access_token`
   (`client_id`, `client_secret`, `grant_type=authorization_code`, `redirect_uri`, `code`) e esse por um de 60 dias em
   `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=...&access_token=...`.
   Grave o de 60 dias em `INSTAGRAM_PAGE_ACCESS_TOKEN`. Pegue o id da conta em
   `GET https://graph.instagram.com/v26.0/me?fields=id,user_id,username&access_token=...` e grave o **`user_id`** em
   `INSTAGRAM_BUSINESS_ACCOUNT_ID`. Por fim, inscreva a conta nas mensagens:
   `POST https://graph.instagram.com/v26.0/me/subscribed_apps?subscribed_fields=messages&access_token=...`.
   (Alternativa: o botão "Adicionar conta" › "Gerar token" da própria página faz o mesmo por um pop-up, que o Chrome
   precisa permitir, e pede o login da conta do negócio ali.) **O token vence em 60 dias:** antes disso, renove com
   `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=...` e troque no `.env`.
8. **Publicar o app** (menu "Publicar"): a Meta só entrega webhooks a app publicado. Para publicar ela exige, em
   Configurações › Básico, ícone 1024×1024, URL da política de privacidade, categoria e URL de exclusão de dados.
   Se ela disser "URL da política inválido", confira no Depurador de Compartilhamento (Ferramentas): o rastreador
   dela pode ter levado 429 do seu site; "Extrair novamente" costuma resolver.
9. **Teste:** na seção do webhook, "Teste" no campo `messages` › "Enviar para servidor". `GET <RELAY_URL>/health`
   mostra `total: 1`, e o worker local puxa o evento na próxima passada (ele descarta, porque não é lead: certo).

**Não é preciso pedir a "análise do app" à Meta** para conversar com os seus leads: com a conta do negócio como
testadora, o app publicado e o portfólio verificado, as respostas saem pela API. A análise só seria necessária para
oferecer o serviço a outras empresas (modo "Tech Provider", irreversível).

## 6. Rodar

Um comando sobe o painel e o worker:

```bash
npm run dev
```

Painel em **http://localhost:3100**. A faixa cinza no topo diz o estado: "Sistema rodando", "Modo simulação" e
o gasto de IA do mês. O worker agenda sozinho os jobs do dia: descoberta por hashtag e palavra-chave dentro do
horário de operação, leitura e pontuação de cada perfil, e a primeira mensagem para os qualificados.

Para rodar sem o painel: `npm run worker`. Para rodar uma passada só: `npm run worker:once`.

## 6b. O que a primeira mensagem faz

- **Alvo:** quem já grava vídeo falando do próprio trabalho, ou está tentando. A profissão é só uma pista; o que
  qualifica é ter post público recente, de preferência Reels. Perfil sem post legível não é abordado: não há o que
  elogiar nem o que testar.
- **Antes de mandar, o sistema lê até 3 posts da pessoa** (legenda e data) e **passa a seguir** o perfil (só no envio
  real; `FOLLOW_BEFORE_DM=true` no `.env`).
- **A mensagem é honesta do começo ao fim:** começa elogiando um post real (a IA tem de apontar qual, e o código
  confere), diz quem você é e por que está escrevendo (com as palavras de `config/business.json › offer.founderStory`),
  pede o teste e o feedback, e deixa claro que um "não faz sentido para mim" também ajuda. Sem link, sem preço, sem
  promessa. Escrita como quem digita no celular, nunca como uma empresa.
- **Três variantes no experimento** (pedido completo, curta, de colega), medidas pela taxa de resposta.
- **Ritmo:** comece com 5 mensagens por dia e suba devagar. O teto mora em dois lugares: no painel
  (`limits.override`, lido a cada envio) e no `.env` (`MAX_DMS_PER_DAY`, `WARMUP_START_PER_DAY`,
  `WARMUP_STEP_PER_WEEK`). Para mudar, mude os dois.

## 7. Testar, na ordem certa

1. **Simulação completa, sem internet:** `npm run simulate`. Roda o fluxo inteiro com um Instagram falso, uma IA
   falsa e uma API falsa, e escreve `data/simulation-report.md`. Serve para ver o caminho de ponta a ponta.
2. **Dry-run no Chrome de verdade:** com o Chrome do passo 4 aberto e logado, `npm run dev`. Em Leads, adicione um
   perfil à mão (por exemplo um perfil seu de teste) ou peça "Descobrir agora" com `#dentista`. O worker lê o
   perfil, pontua, escreve a mensagem com a IA, **digita no campo e apaga sem enviar**. Você vê a mensagem na
   linha do tempo do lead, marcada "Simulada (não enviada)".
3. **Piloto real, só quando você autorizar:** no `.env`, `BROWSER_SEND_ENABLED=true`, reinicie, e na faixa do topo
   clique **"Ligar envio real"**. Comece com 5 por dia.

Nada é enviado de verdade sem os dois passos do item 3.

## 8. Pausar, retomar e os limites

- **Pausar tudo**: botão vermelho na faixa do topo (ou qualquer alerta do Instagram, erro repetido, orçamento
  de IA ou pedido de parar em excesso: o sistema pausa sozinho e abre uma exceção dizendo por quê).
- **Retomar tudo**: o mesmo botão. Antes, veja a aba **Exceções**.
- **Limites**: aba Configurações. O `.env` é o teto; no painel você só aperta (menos mensagens por dia, intervalo
  maior, horário mais curto).
- **Não contatar**: aba Registro. Quem pede para parar entra sozinho e nunca mais recebe nada, por nenhum canal.

## 9. Backup e restauração

- Backup automático uma vez por dia em `backups/` (os 30 últimos ficam). Para fazer agora: `npm run db:backup`.
- Restaurar: pare o painel e o worker (Ctrl+C), depois
  ```bash
  npm run db:restore -- backups/prospector-<data>.db
  ```
  O arquivo atual fica guardado como `.before-restore`, então dá para voltar atrás.

## 10. Se a chave vazar

1. OpenRouter: https://openrouter.ai/settings/keys → revogue a chave, crie outra, atualize o `.env`.
2. Meta: no app, Configurações › Básico › **redefinir o App Secret**; gere um novo token da Página; atualize o `.env`.
3. Reinicie `npm run dev`. Os leads, as conversas e o histórico ficam no `data/prospector.db`, nada se perde.
4. Se a sessão do Instagram puder ter sido exposta, troque a senha da conta e saia dos outros aparelhos.

## 11. O que o painel mostra

Visão geral (funil, ritmo do dia, custo de IA por lead e por cliente ativo) · Leads (kanban, com a linha do tempo,
a conversa e as ações de cada um) · Fila (os jobs) · Exceções (o que parou para você olhar) · Experimentos (as três
variantes da primeira mensagem, com taxa de resposta) · Custo de IA · Registro (log de tudo e a lista de não
contatar) · Configurações.

Marque "Cadastrado" e "Cliente ativo" à mão no lead quando souber: a App Store não diz quem instalou a partir de
uma DM, e são esses dois números que dizem se a prospecção paga a conta.

## 12. Segunda instância: outro produto, mesmo código

O sistema não sabe de produto nenhum: tudo o que é de um negócio mora em `config/business.json` (empresa, oferta,
história de quem escreve, posicionamento, fatos verificados, público, hashtags, links por nicho e WhatsApp), no
`.env` (chaves, token da Meta, conta, portas) e nas pastas ignoradas pelo git (`.chrome-profile/`, `data/`). Para
prospectar para outro produto, **clona-se o mesmo repositório em outra pasta** e preenche-se essas três coisas.
Correção de código vai para o repositório e chega às duas cópias com `git pull`; cada cópia reinicia o seu worker.

**O que separa as instâncias na mesma máquina:**

| | 1ª instância | 2ª instância |
|---|---|---|
| Pasta | `~/prospector` | `~/outro-produto/prospector` |
| Chrome dedicado | porta 9222 | `CHROME_DEBUG_PORT=9223 scripts/chrome-debug.sh` (perfil próprio) |
| Painel | 3100 | `PANEL_PORT=3101` no `.env` |
| Caixa de entrada | Worker `<produto-1>-inbox` | `npx wrangler deploy --name <produto-2>-inbox` + segredos próprios |
| App da Meta | app do produto 1 | app próprio, no portfólio da empresa 2 |
| Chave OpenRouter | uma por produto, com limite próprio | idem |

**Como a segunda instância foi montada (receita para o próximo produto):**

1. Clone, `npm install`, `.env` a partir do `.env.example` com as portas e a URL do Worker novo.
2. Chrome dedicado na porta nova; a pessoa loga o Instagram do produto nele. **A janela tem de ter largura de
   desktop**: com 744 px o Instagram serve o layout de celular e a caixa de mensagem não fica onde o worker procura
   (o script passou a abrir com 1440 px).
3. Worker da caixa de entrada publicado com outro nome; `VERIFY_TOKEN` e `RELAY_TOKEN` gerados; `APP_SECRET`
   depois do app da Meta.
4. No Meta for Developers: app novo (caso de uso Instagram) **no portfólio da empresa** (já com verificação de
   empresa e de acesso); "Add all required permissions"; webhook com a URL do Worker e o verify token (a Meta
   assina todos os campos; só `messages` importa); a conta do Instagram como **Testadora do Instagram** (o convite
   se aceita no Instagram, em Configurações › Apps e sites, pelo Chrome dedicado); login da empresa com a URL de
   redirecionamento `…workers.dev/oauth`; ficha do app (ícone 1024, política, termos, exclusão de dados, categoria)
   e **Publicar**. Se a Meta disser "URL da política inválido", confira no Depurador de Compartilhamento: um site
   pode devolver 429 ao rastreador dela; "Extrair novamente" resolve.
5. **O token sem senha nenhuma:** a URL de autorização (`instagram.com/oauth/authorize?client_id=<id do app
   Instagram>&redirect_uri=…/oauth&response_type=code&scope=instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments`)
   aberta no Chrome dedicado (já logado), "Permitir", o `code` lido da URL de volta, trocado em
   `api.instagram.com/oauth/access_token` e depois em `graph.instagram.com/access_token?grant_type=ig_exchange_token`
   (60 dias; renovar com `refresh_access_token` antes). `POST /me/subscribed_apps?subscribed_fields=messages`.
   O id da conta para o `.env` é o `user_id` de `/me?fields=id,user_id,username`.
6. Chave OpenRouter nova, `business.json` preenchido (a partir da landing page e do que você pode provar), `npm run dev`,
   simulação, e só então o envio real.

## 13. Histórico e estado

O que aconteceu em cada piloto (datas, decisões de cota, lições do Instagram) fica em `docs/piloto-2026-10.md`,
e não aqui: este manual descreve o sistema, não um operador. O repositório é público desde 13/10/2026.

## 14. Outras redes (planejado, não construído)

O sistema foi desenhado com a rede isolada numa camada. É genérico (e serve a qualquer rede): o banco e os
estados do lead, a fila de jobs, a IA que escreve e conduz, o verificador de afirmações, os experimentos de
abordagem, o follow-up único, os disjuntores, a cota e o ritmo, o painel. É do Instagram: a implementação do
navegador (buscar perfis, ler perfil, mandar a primeira mensagem, detectar restrição), a continuação pela API da
Meta e a pontuação por Reels e seguidores.

**Para o LinkedIn** seria preciso: (1) um adaptador de navegador novo (busca por cargo, setor e palavra-chave;
leitura de cabeçalho, "sobre" e atividade; detecção de restrição); (2) o primeiro contato em dois passos —
**pedido de conexão → aceite → mensagem** — com dois estados a mais no funil, lembrando que a nota do convite tem
300 caracteres e, em contas gratuitas, só algumas por mês levam nota; (3) a leitura das respostas também pelo
navegador, varrendo a caixa de mensagens a cada poucos minutos, porque o LinkedIn não tem API de mensagens
aberta; (4) pontuação por cargo, setor, tamanho de empresa e atividade recente, num bloco de público por rede no
`business.json`; (5) limites conservadores: 15 a 20 convites por dia, 100 por semana — a conta é o seu perfil
pessoal, e o LinkedIn restringe mais rápido que o Instagram. Esforço: dois ou três dias de código depois de o fluxo
do Instagram estar aprovado, mais uma semana em simulação para calibrar os seletores da interface.

**As outras:**

| Rede | Primeiro contato | Resposta | Observação |
|---|---|---|---|
| Facebook (Páginas) | mensagem pela Página, API oficial do Messenger | API oficial | o mais parecido com o que existe; mesmo app da Meta |
| LinkedIn | navegador (convite + mensagem) | navegador | o mais arriscado para a conta |
| TikTok | navegador | navegador | sem API de DM |
| X | API paga de DM | API | abordagem fria por DM rende pouco |
| WhatsApp | não serve para frio: a API exige opt-in e modelos aprovados | | bom como destino, não como origem |

Ordem recomendada quando chegar a hora: Facebook primeiro (barato, mesma API), LinkedIn depois.
