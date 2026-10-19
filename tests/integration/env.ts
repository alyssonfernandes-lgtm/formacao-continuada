// Ambiente de teste: banco PostgreSQL real separado e servidor SMTP local real (smtp-server)
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://formacao:formacao_dev@localhost:5432/formacao_test';
process.env.PUBLIC_URL = 'http://localhost:3000';
process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.CPF_HMAC_KEY = 'b'.repeat(64);
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = '2526';
process.env.SMTP_FROM = 'Formacao <nao-responda@teste.local>';
process.env.LOG_LEVEL = 'silent';
