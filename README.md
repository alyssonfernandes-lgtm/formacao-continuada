# Formação Continuada — Educação Municipal

Plataforma web para a Secretaria Municipal de Educação divulgar eventos de formação, receber inscrições, credenciar participantes por QR Code, emitir certificados verificáveis e gerar relatórios. O nome, as cores, o logotipo e os dados institucionais são configurados no painel (Configurações), sem alterar código.

## O que a plataforma faz

| Público | Funções |
|---|---|
| Professores e profissionais | Lista de eventos, inscrição com revisão antes de confirmar, protocolo, QR Code pessoal, e-mail de confirmação, página "minha inscrição" (por link secreto), reenvio do e-mail, verificação pública de certificado |
| Administração | Configurações institucionais, usuários e perfis, escolas, auditoria, fila de e-mails |
| Coordenação | Eventos e sessões, equipe de credenciamento, inscrições, presenças, certificados, relatórios |
| Credenciamento | Leitura de QR Code pela câmera do celular, busca manual, correções com justificativa (somente nos eventos designados) |
| Consulta | Painel e relatórios resumidos (sem CPF, e-mail ou telefone) |

## Tecnologia

- **Servidor:** Node.js 22, TypeScript, Fastify 5.
- **Banco:** PostgreSQL 16, com migrações SQL versionadas em `src/server/db/migrations`.
- **Interface:** React 18, Vite, Tailwind. É instalável como aplicativo (PWA).
- **E-mail:** SMTP com nodemailer e fila persistente no banco, com novas tentativas.
- **Documentos:** PDF com pdfkit, planilhas com exceljs, QR Code com qrcode. A leitura pela câmera usa jsQR.
- **Proteção de dados:**
  - senhas guardadas com argon2id;
  - CPF cifrado com AES-256-GCM e um índice HMAC para encontrar duplicados sem guardar o CPF em claro;
  - sessões com cookie httpOnly, proteção CSRF e limites de tentativas.

## Começar em desenvolvimento

Requisitos: Node 22+ e PostgreSQL 14+.

```bash
npm install
cp .env.example .env
#   Edite .env:
#   NODE_ENV=development, PUBLIC_URL=http://localhost:5173, TRUST_PROXY=false
#   DATABASE_URL apontando para um banco vazio
#   DATA_ENCRYPTION_KEY e CPF_HMAC_KEY: gere cada uma com  openssl rand -hex 32
#   SMTP_HOST=127.0.0.1  SMTP_PORT=2525  SMTP_SECURE=false  SMTP_REQUIRE_TLS=false  (servidor de teste abaixo)
createdb formacao
npm run migrate
npm run create-admin -- "Seu Nome" voce@exemplo.org "SenhaComPeloMenos12"
npm run dev:smtp   # em outro terminal: recebe os e-mails e grava em ./mailbox/*.eml
npm run dev        # API em :3000 e interface em http://localhost:5173
```

O painel fica em `/admin`. Para testar a câmera num celular, a página precisa estar em HTTPS. Veja a seção "Câmera" em [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md).

## Comandos

| Comando | Para quê |
|---|---|
| `npm run build` | Gera `dist/` (interface e servidor) |
| `npm start` | Inicia o servidor compilado. Aplica as migrações pendentes ao iniciar |
| `npm run worker` | Processa a fila de e-mails num processo separado (use com `WORKER_INLINE=false`) |
| `npm run migrate` | Aplica as migrações |
| `npm run create-admin` | Cria ou reativa um administrador |
| `npm test` | Testes de unidade e de aceitação (precisa de PostgreSQL; veja [docs/TESTES.md](docs/TESTES.md)) |
| `npm run test:e2e` | Testes no navegador (Chromium), com celular emulado e câmera simulada |

## Documentação

- [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md) cobre:
  - variáveis de ambiente, HTTPS, Docker e implantação passo a passo;
  - backup e restauração, monitoramento e atualizações;
  - incidentes, LGPD e custódia das chaves.
- [docs/TESTES.md](docs/TESTES.md) traz os 12 cenários de aceitação, como executá-los, os resultados obtidos e o que ainda precisa ser testado em ambiente real.

## Estrutura

```
src/server/        API, serviços, migrações, fila de e-mails, scripts
src/shared/        Validações e permissões usadas no servidor e na interface
src/web/           Interface (páginas públicas e painel)
tests/unit/        Testes de regras isoladas
tests/integration/ Testes de aceitação contra PostgreSQL e SMTP reais
tests/e2e/         Testes no navegador (Playwright)
deploy/            Docker Compose, Caddy e exemplo de Nginx
scripts/           Backup e restauração
```

## O que depende da Secretaria

- **Identidade visual:** o logotipo oficial enviado pela Secretaria (Prefeitura de Balneário Rincão — Secretaria de Educação) é carregado na primeira inicialização e pode ser trocado em Configurações.
- **Certificados:** a assinatura padrão é da Professora Jucilene Antonio Fernandes, Secretária Municipal de Educação (nome e cargo impressos; não há imagem de assinatura manuscrita). Pode ser alterada em Configurações ou por evento.
- **E-mail:** conta SMTP institucional ou serviço transacional, com SPF, DKIM e DMARC configurados no domínio.
- **Endereço e servidor:** domínio, servidor e certificado HTTPS.
- **LGPD:** nome do controlador e do encarregado (DPO), contato, revisão jurídica do aviso de privacidade e prazos de retenção.
- **Escolas:** lista oficial das escolas, cadastrada pelo painel.
