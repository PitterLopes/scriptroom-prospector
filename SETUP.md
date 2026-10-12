# Scriptroom Prospector — manual do operador

Este sistema prospecta profissionais no Instagram para o Scriptroom: descobre perfis, pontua, manda uma primeira
mensagem pessoal pelo **seu** Chrome, e continua a conversa pela **API oficial da Meta** quando a pessoa responde.
Ele roda só na sua máquina. Nada sobe para servidor nenhum além da OpenRouter (a IA) e da Meta (a API).

**Antes de começar, o aviso honesto:** mandar DM automatizada pela interface do Instagram vai contra os termos de
uso da Meta. O sistema imita o ritmo de uma pessoa e para sozinho ao primeiro sinal de restrição, mas a conta usada
(hoje, `@lopespitter`) pode ser limitada ou bloqueada. Por isso ele nasce em **modo simulação**: nada é enviado até
você ligar o envio real em dois lugares, de propósito.

---

## 1. O que você precisa

- macOS, Linux ou Windows com **Node.js 22 ou mais novo** (`node -v`).
- **Google Chrome** instalado.
- Uma conta **Business ou Creator** no Instagram, ligada a uma **Página do Facebook** (a `@lopespitter` já é).
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

Por que uma chave separada: o custo deste projeto aparece separado do app no painel da OpenRouter, e se ela vazar
você revoga só ela, sem mexer no servidor do Scriptroom.

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
e você responde à mão. Com ela, a IA responde sozinha dentro das regras.

1. **Feito em 12/10/2026:** no app **Scriptroom** do Meta for Developers entrou o caso de uso "Gerenciar mensagens
   e conteúdo no Instagram" (API com login do Instagram, app do Instagram `Scriptroom-IG`), com as permissões
   `instagram_business_basic`, `instagram_business_manage_comments` e `instagram_business_manage_messages`.
2. **Feito em 12/10/2026:** a `@lopespitter` foi adicionada como "Testadora do Instagram" do app, o convite foi
   aceito no Instagram, o token de acesso foi gerado (a janela de gerar token é um pop-up: o Chrome precisa permitir
   pop-ups de developers.facebook.com) e a conta foi inscrita no campo `messages` do webhook.
3. **No `.env` já estão** `INSTAGRAM_PAGE_ACCESS_TOKEN` (token do Instagram, prefixo `IGAA`, de longa duração: a Meta
   avisa quando ele vence; gere outro no mesmo lugar e troque no `.env`), `INSTAGRAM_BUSINESS_ACCOUNT_ID`
   (17841401199182901), `INSTAGRAM_APP_SECRET` e `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`. O id que `/me` devolve para
   esse token é outro (28721963587423697): é o id do usuário na API com login do Instagram. Nenhum dos dois é segredo.
4. Enquanto o app não passa pela **análise da Meta** (etapa 5 na página do caso de uso), só contas com função no app
   (você) conseguem conversar pela API. Para o piloto com leads de verdade, peça a análise de
   `instagram_business_manage_messages` quando o fluxo estiver provado.
5. **O webhook já está configurado** (feito em 12/10/2026): a Meta entrega as mensagens numa caixa de entrada
   na sua Cloudflare, o Worker `scriptroom-prospector-inbox` (pasta `relay/`), em
   `https://scriptroom-prospector-inbox.pitterdebarros.workers.dev/webhook`, assinado com o segredo do app do
   Instagram. O sistema no Mac busca os eventos de lá a cada poucos segundos (`RELAY_URL` e `RELAY_TOKEN` no
   `.env`). Funciona mesmo com o Mac desligado: os eventos esperam até 14 dias. Para republicar o Worker depois
   de uma mudança: `cd relay && npx wrangler deploy`. Os segredos dele (`APP_SECRET`, `VERIFY_TOKEN`,
   `RELAY_TOKEN`) ficam na Cloudflare; para trocar, `npx wrangler secret put <NOME>` dentro de `relay/`.
   Se um dia preferir um túnel direto para o Mac, a rota local `/api/webhooks/instagram` continua existindo.
6. Em modo de desenvolvimento, o app só recebe mensagens de contas com papel no app (você). Para receber de qualquer
   pessoa, o app precisa do **App Review** da Meta para `instagram_manage_messages`. Enquanto isso, teste com uma
   segunda conta sua adicionada como testadora.

## 6. Rodar

Um comando sobe o painel e o worker:

```bash
npm run dev
```

Painel em **http://localhost:3100**. A faixa cinza no topo diz o estado: "Sistema rodando", "Modo simulação" e
o gasto de IA do mês. O worker agenda sozinho os jobs do dia: descoberta por hashtag e palavra-chave dentro do
horário de operação, leitura e pontuação de cada perfil, e a primeira mensagem para os qualificados.

Para rodar sem o painel: `npm run worker`. Para rodar uma passada só: `npm run worker:once`.

## 6b. O que a primeira mensagem faz (decidido em 12/10/2026)

- **Alvo:** quem já grava vídeo falando do próprio trabalho, ou está tentando. A profissão é só uma pista; o que
  qualifica é ter post público recente, de preferência Reels. Perfil sem post legível não é abordado: não há o que
  elogiar nem o que testar.
- **Antes de mandar, o sistema lê até 3 posts da pessoa** (legenda e data) e **passa a seguir** o perfil (só no envio
  real; `FOLLOW_BEFORE_DM=true` no `.env`).
- **A mensagem é honesta do começo ao fim:** começa elogiando um post real (a IA tem de apontar qual, e o código
  confere), diz que você está desenvolvendo o app sozinho e sem investimento de fora, pede o teste e o feedback, e
  deixa claro que um "não faz sentido para mim" também ajuda. Sem link, sem preço, sem promessa. O texto base está em
  `config/business.json › offer.founderStory`.
- **Três variantes no experimento** (pedido completo, curta, de colega), medidas pela taxa de resposta.
- **Ritmo:** 15 mensagens por dia no máximo, começando com 5 e subindo 5 por semana.

## 7. Testar, na ordem certa

1. **Simulação completa, sem internet:** `npm run simulate`. Roda o fluxo inteiro com um Instagram falso, uma IA
   falsa e uma API falsa, e escreve `data/simulation-report.md`. Serve para ver o caminho de ponta a ponta.
2. **Dry-run no Chrome de verdade:** com o Chrome do passo 4 aberto e logado, `npm run dev`. Em Leads, adicione um
   perfil à mão (por exemplo um perfil seu de teste) ou peça "Descobrir agora" com `#dentista`. O worker lê o
   perfil, pontua, escreve a mensagem com a IA, **digita no campo e apaga sem enviar**. Você vê a mensagem na
   linha do tempo do lead, marcada "Simulada (não enviada)".
3. **Piloto real, só quando você autorizar:** no `.env`, `BROWSER_SEND_ENABLED=true`, reinicie, e na faixa do topo
   clique **"Ligar envio real"**. Começa com 5 mensagens por dia (aquecimento) e sobe 5 por semana até 15.

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
