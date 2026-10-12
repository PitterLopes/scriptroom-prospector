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

1. Em https://developers.facebook.com, no app **Scriptroom** (o mesmo da medição de anúncios), adicione o produto
   **Instagram** › **Messenger API for Instagram** (ou "Instagram Messaging").
2. Conecte a Página do Facebook ligada à `@lopespitter` e gere um **token de acesso da Página** com as permissões
   `instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata`, `pages_messaging`.
3. Copie para o `.env`: `INSTAGRAM_APP_SECRET` (Configurações › Básico), `INSTAGRAM_PAGE_ACCESS_TOKEN`,
   `INSTAGRAM_BUSINESS_ACCOUNT_ID` (o ID da conta Instagram profissional).
4. Invente um `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` longo (qualquer texto) e cole no `.env`.
5. O webhook precisa de um endereço público HTTPS apontando para a sua máquina. Com o sistema rodando:
   ```bash
   npx cloudflared tunnel --url http://localhost:3100
   ```
   (ou `ngrok http 3100`). Copie o endereço gerado e cadastre em Webhooks › Instagram:
   URL `https://<seu-endereco>/api/webhooks/instagram`, token de verificação igual ao do `.env`, e assine o campo
   **messages**.
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

## 7. Testar, na ordem certa

1. **Simulação completa, sem internet:** `npm run simulate`. Roda o fluxo inteiro com um Instagram falso, uma IA
   falsa e uma API falsa, e escreve `data/simulation-report.md`. Serve para ver o caminho de ponta a ponta.
2. **Dry-run no Chrome de verdade:** com o Chrome do passo 4 aberto e logado, `npm run dev`. Em Leads, adicione um
   perfil à mão (por exemplo um perfil seu de teste) ou peça "Descobrir agora" com `#dentista`. O worker lê o
   perfil, pontua, escreve a mensagem com a IA, **digita no campo e apaga sem enviar**. Você vê a mensagem na
   linha do tempo do lead, marcada "Simulada (não enviada)".
3. **Piloto real, só quando você autorizar:** no `.env`, `BROWSER_SEND_ENABLED=true`, reinicie, e na faixa do topo
   clique **"Ligar envio real"**. Começa com 5 mensagens por dia (aquecimento) e sobe 5 por semana até 30.

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
