# Implantação, operação e manutenção

Este guia é para a equipe de TI que vai colocar a plataforma no ar e mantê-la funcionando.

## 1. Requisitos

| Item | Mínimo recomendado |
|---|---|
| Servidor | Linux com 2 vCPU, 2 GB de RAM e 20 GB de disco (o banco cresce pouco: cerca de alguns KB por inscrição) |
| Software | Docker com Compose v2 **ou** Node.js 22 + PostgreSQL 16 |
| Rede | Domínio próprio (ex.: `formacao.educacao.municipio.gov.br`) apontando para o servidor; portas 80 e 443 abertas |
| E-mail | Conta SMTP com autenticação e TLS (servidor institucional ou serviço transacional: Amazon SES, SendGrid, Mailgun, Brevo etc.) |

## 2. HTTPS é obrigatório

- **Câmera:** os navegadores só liberam a câmera em páginas HTTPS, e `localhost` é a única exceção. Sem HTTPS, o credenciamento por QR Code não funciona no celular. O operador verá a mensagem de câmera indisponível, e restará apenas a busca manual.
- **Sessão:** em produção, o cookie de sessão é marcado como `Secure` e o servidor envia HSTS. Por isso, o painel só funciona sobre HTTPS.
- **Instalação:** a instalação como aplicativo (PWA) também exige HTTPS.

Use um proxy reverso que termine o TLS:

- **Caddy** (recomendado, certificado automático): veja `deploy/Caddyfile`, já usado no Docker Compose.
- **Nginx + certbot:** use `deploy/nginx.conf.example` como base. Mantenha `X-Forwarded-Proto` e `X-Forwarded-For`, e defina `TRUST_PROXY=true`.

Nunca exponha a porta 3000 da aplicação diretamente à internet.

## 3. Variáveis de ambiente

Todas estão documentadas em `.env.example`. Os segredos ficam **apenas** no `.env` do servidor ou num cofre de segredos. Nunca vão para o código, para o repositório ou para a interface.

| Variável | Obrigatória | Descrição |
|---|---|---|
| `NODE_ENV` | sim | `production` no servidor |
| `PUBLIC_URL` | sim | Endereço público com `https://`. Aparece nos e-mails, QR Codes e certificados. **Não altere depois de emitir QR Codes e certificados**, pois os links impressos deixariam de funcionar |
| `TRUST_PROXY` | sim atrás de proxy | `true` para que o IP real do usuário seja usado nos limites de tentativas e na auditoria |
| `DATABASE_URL` | sim | Conexão com o PostgreSQL |
| `DATA_ENCRYPTION_KEY` | sim | 64 caracteres hexadecimais (`openssl rand -hex 32`). Cifra CPF e tokens |
| `CPF_HMAC_KEY` | sim | 64 caracteres hexadecimais, **diferente** da anterior. Gera o índice para detectar CPF repetido |
| `SESSION_TTL_HOURS`, `SESSION_IDLE_MINUTES` | não | Duração máxima da sessão do painel (8 h) e tempo de inatividade (60 min) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | para enviar e-mails | Sem `SMTP_HOST` e `SMTP_FROM`, os e-mails ficam "pendentes" na fila e aparecem assim no painel. Nada é dado como enviado sem o aceite do servidor SMTP. Porta 587: `SMTP_SECURE=false` e `SMTP_REQUIRE_TLS=true`. Porta 465: `SMTP_SECURE=true` |
| `WORKER_INLINE` | não | `true` (padrão) processa a fila dentro do servidor web. Use `false` e rode `npm run worker` à parte se houver mais de uma instância web |
| `WORKER_POLL_MS` | não | Intervalo de verificação da fila (padrão 5000 ms) |
| `LOG_LEVEL` | não | `info` (padrão). Os registros não contêm CPF, senha nem token |

**Custódia das chaves:**

- Guarde `DATA_ENCRYPTION_KEY` e `CPF_HMAC_KEY` num cofre de senhas da Secretaria, com acesso de pelo menos duas pessoas.
- Sem essas chaves, um backup do banco não permite recuperar CPFs nem encontrar inscrições pelo CPF.
- Elas não podem ser trocadas depois do início do uso. A troca exigiria recifrar a base, o que não está automatizado.

## 4. Implantação com Docker Compose (recomendada)

```bash
git clone <repositório> formacao && cd formacao/deploy
cp ../.env.example .env
# Edite deploy/.env e preencha:
#   DOMINIO=formacao.educacao.municipio.gov.br
#   POSTGRES_PASSWORD=<senha longa e aleatória>
#   DATA_ENCRYPTION_KEY=<openssl rand -hex 32>
#   CPF_HMAC_KEY=<openssl rand -hex 32>
#   SMTP_*  (credenciais do provedor de e-mail)
chmod 600 .env
docker compose up -d --build
docker compose exec app node dist/server/server/scripts/create-admin.js "Nome do Administrador" admin@municipio.gov.br "SenhaForteComNumeros123"
```

O que esses comandos fazem:

- O Compose sobe o PostgreSQL, a aplicação e o Caddy. O Caddy obtém o certificado HTTPS sozinho, desde que o DNS já aponte para o servidor.
- As migrações do banco são aplicadas automaticamente quando a aplicação inicia.

Depois, entre em `https://DOMINIO/admin` e:

1. Em **Configurações**, preencha o nome da plataforma, a Secretaria, o município, as cores, o contato, o controlador e o encarregado (DPO). Envie o logotipo oficial (PNG ou JPEG).
2. Em **Escolas**, cadastre a lista oficial de escolas.
3. Em **Usuários**, crie as contas de coordenação, credenciamento e consulta. Cada pessoa troca a senha no primeiro acesso.
4. Envie um e-mail de teste: faça uma inscrição num evento de teste e confira em **E-mails** se o estado chegou a "enviado".

> Observação: a imagem Docker não pôde ser construída no ambiente em que a plataforma foi desenvolvida, porque o registro de imagens e o npm não estavam acessíveis de dentro dele. O mesmo build (`npm ci && npm run build`) foi executado e testado fora do Docker. Faça o primeiro `docker compose up --build` em homologação antes da produção.

## 5a. Implantação no Render (mais rápida, sem servidor próprio)

O arquivo `render.yaml` cria a aplicação Node e o PostgreSQL gerenciado, com HTTPS automático no endereço `*.onrender.com` (ou em um domínio próprio).

1. Envie o código para um repositório no GitHub.
2. No Render, use **New > Blueprint** e escolha o repositório.
3. Preencha as variáveis pedidas:
   - `PUBLIC_URL`: o endereço https que o Render mostrar;
   - `DATA_ENCRYPTION_KEY` e `CPF_HMAC_KEY`: gere cada uma com `openssl rand -hex 32`;
   - `SMTP_*`: credenciais do e-mail. Se deixar em branco, os e-mails ficam pendentes.
4. Depois do primeiro deploy, crie o administrador. No **Shell** do serviço, rode:
   `node dist/server/server/scripts/create-admin.js "Nome" email@municipio.gov.br "SenhaForte123456"`

Use planos pagos para o serviço e o banco. No plano gratuito, o serviço "dorme" quando fica sem acesso e o banco tem prazo de validade. Confira os preços atuais no site do Render. O build e a inicialização exatamente como o Render os executa foram testados no ambiente de desenvolvimento.

## 5. Implantação sem Docker

```bash
# Requisitos: Node 22, PostgreSQL 16
sudo -u postgres createuser -P formacao
sudo -u postgres createdb -O formacao formacao
npm ci && npm run build && npm prune --omit=dev
cp .env.example .env && chmod 600 .env   # preencha
node --env-file=.env dist/server/server/index.js
```

Rode a aplicação como serviço (systemd) com um usuário sem privilégios e `Restart=always`, atrás do Nginx ou do Caddy.

Exemplo de unidade systemd:

```ini
[Unit]
Description=Formação Continuada
After=network.target postgresql.service

[Service]
User=formacao
WorkingDirectory=/opt/formacao
ExecStart=/usr/bin/node --env-file=/opt/formacao/.env dist/server/server/index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

## 6. E-mail transacional

- Use um remetente do domínio da prefeitura, por exemplo `nao-responda@educacao.municipio.gov.br`, e configure **SPF, DKIM e DMARC** nesse domínio. Sem isso, as mensagens tendem a cair no spam.
- A fila tenta até 6 vezes, com intervalos crescentes: 1, 2, 4, 8 e 16 minutos.
  - Uma mensagem só fica "enviado" quando o servidor SMTP aceita o destinatário.
  - Depois da última tentativa, ela fica "falhou", com o erro visível em **E-mails**, onde pode ser reenviada.
- O provedor pode limitar o volume diário. Confira o limite antes de liberar certificados de eventos grandes.

## 7. Backup e restauração

**Backup diário cifrado:** use `scripts/backup.sh`, que roda `pg_dump`, cifra o arquivo com GPG e grava um hash de conferência.

```bash
# Arquivo com a senha do backup (diferente das chaves da aplicação), permissão 600
echo 'senha-longa-do-backup' > /root/.formacao-backup-pass && chmod 600 /root/.formacao-backup-pass
# Sem Docker:
DATABASE_URL=postgres://formacao:...@localhost/formacao BACKUP_PASSPHRASE_FILE=/root/.formacao-backup-pass BACKUP_DIR=/var/backups/formacao ./scripts/backup.sh
# Com Docker Compose (o banco não expõe porta):
docker compose -f deploy/docker-compose.yml exec -T db pg_dump -U formacao -Fc formacao \
  | gpg --batch --symmetric --cipher-algo AES256 --passphrase-file /root/.formacao-backup-pass \
    -o /var/backups/formacao/formacao-$(date +%Y%m%d).dump.gpg
```

- Agende com cron, por exemplo `0 2 * * *`.
- Copie os arquivos para **fora do servidor**: outro data center, armazenamento de objetos ou mídia externa.
- A retenção padrão é de 30 dias e pode ser alterada em `BACKUP_KEEP_DAYS`.

**Restauração:** use `scripts/restore.sh`, sempre num banco **vazio**.

```bash
createdb formacao_restaurado
DATABASE_URL=postgres://.../formacao_restaurado BACKUP_PASSPHRASE_FILE=/root/.formacao-backup-pass \
  ./scripts/restore.sh /var/backups/formacao/formacao-AAAAMMDD-HHMMSS.dump.gpg
```

- A aplicação restaurada precisa usar as **mesmas** `DATA_ENCRYPTION_KEY` e `CPF_HMAC_KEY` da original.
- **Teste a restauração em homologação pelo menos uma vez por semestre.** Um backup que nunca foi restaurado não é garantia.
- Observação: os scripts de backup e restauração foram revisados, mas não foram executados no ambiente de desenvolvimento.

O logotipo e as configurações ficam no próprio banco, então o backup do banco cobre tudo. Nenhum dado importante fica apenas no navegador.

## 8. Monitoramento

- **Saúde:** `GET /api/health` responde 200 quando a aplicação e o banco estão acessíveis. Use-o no monitor externo (UptimeRobot, Zabbix etc.) e no balanceador. A imagem Docker já tem `HEALTHCHECK`.
- **Fila de e-mails:** a tela **E-mails** mostra quantas mensagens estão pendentes ou falharam. Muitos itens "pendente" com erro indicam problema no SMTP.
- **Logs:** a aplicação escreve JSON na saída padrão (`docker compose logs app`). Procure por `level: 50` (erro).
- **Auditoria:** a tela **Auditoria** mostra quem fez o quê, incluindo exportações de relatórios, correções de presença, reemissões e revogações de certificados.

## 9. Manutenção e atualizações

- **Retenção automática:** a aplicação executa uma rotina diária que apaga:
  - sessões expiradas e pedidos de troca de senha vencidos;
  - registros de e-mail antigos (180 dias, por padrão);
  - inscrições canceladas sem presença nem certificado (365 dias, por padrão);
  - cadastros de participantes que ficaram sem nenhuma inscrição.

  Os prazos são ajustados em **Configurações**. Presenças e certificados válidos não são apagados, porque comprovam a formação.
- **Atualizar a aplicação:**
  1. Faça um backup.
  2. Rode `git pull` e depois `docker compose up -d --build`. As novas migrações são aplicadas na inicialização, sob trava, para evitar execução dupla.
  3. Acesse `/api/health` e faça uma inscrição de teste.
- **Atualizar dependências:** rode `npm audit` mensalmente. Atualize, rode `npm test` e `npm run test:e2e` e só então implante.
- **PostgreSQL:** aplique as atualizações menores da versão 16. Uma mudança de versão maior exige `pg_dump` e restauração.

## 10. Incidentes

| Situação | O que fazer |
|---|---|
| Câmera não abre no credenciamento | Confirme que o endereço é HTTPS e que o navegador tem permissão de câmera. Enquanto isso, use a **busca manual**, por nome ou protocolo |
| E-mails não chegam | Confira em **E-mails** o erro registrado. Verifique as credenciais SMTP, o limite do provedor e o SPF/DKIM. Corrija e use "Tentar novamente" |
| QR Code de um participante vazou | Na inscrição, use **Gerar novo QR Code**. O código antigo deixa de valer imediatamente, e o novo é enviado por e-mail |
| Certificado emitido por engano | **Revogar**, com justificativa. A página de verificação passa a mostrar "revogado". Se houver erro de dados, use **Reemitir**: o anterior fica "substituído" e o histórico é mantido |
| Suspeita de acesso indevido ao painel | Desative a conta em **Usuários**, o que encerra as sessões dela. Consulte a **Auditoria**. Em caso de vazamento de dados pessoais, acione o encarregado (DPO). A LGPD prevê comunicação à ANPD e aos titulares quando houver risco relevante |
| Servidor perdido | Suba um servidor novo, restaure o último backup com as mesmas chaves e aponte o DNS |

## 11. LGPD: decisões já tomadas no sistema

- **Dados coletados:** apenas nome, CPF, escola, e-mail e telefone, para inscrição, controle de presença, certificação e contato sobre o evento. Não há dados sensíveis.
- **CPF:**
  - é guardado cifrado;
  - não aparece completo em páginas públicas, URLs, QR Codes, e-mails, certificados, logs nem mensagens de erro;
  - é mostrado sempre mascarado (`***.456.789-**`).
- **QR Code:** contém apenas um link com um código aleatório, sem nenhum dado pessoal.
- **Relatórios:** a versão **resumida** não traz CPF, e-mail nem telefone. A versão **detalhada** só está disponível para administração e coordenação, e toda exportação fica registrada na auditoria.
- **Aviso de privacidade:** está em `/privacidade`. O participante declara ciência dele ao se inscrever. Os textos do controlador, do encarregado e do complemento vêm das **Configurações** e **precisam de revisão jurídica da Prefeitura**.
- **Base legal sugerida:** execução de políticas públicas e cumprimento de obrigação legal (art. 7º, II e III, da LGPD). A confirmação cabe à Procuradoria ou ao DPO do município.
