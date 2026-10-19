// Fluxo completo no navegador real (Chromium): desktop e celular (emulação de iPhone e Android),
// câmera simulada com vídeo contendo o QR Code real da inscrição.
import { test, expect, chromium, devices, type Browser, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import QRCode from 'qrcode';
import { E2E_ENV } from '../../playwright.config';

test.describe.configure({ mode: 'serial' });

const BASE = 'http://localhost:3100';
const OUT = path.resolve('test-results/e2e-artifacts');
mkdirSync(OUT, { recursive: true });
const shot = (p: Page, name: string) => p.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });

const state: { eventId?: string; token?: string; protocol?: string } = {};

function localInput(minutesFromNow: number) {
  const d = new Date(Date.now() + minutesFromNow * 60_000);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

async function login(page: Page, email: string) {
  await page.goto('/admin/entrar');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill('SenhaForte12345');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => u.pathname.startsWith('/admin') && !u.pathname.startsWith('/admin/entrar'));
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'a página não deve rolar horizontalmente').toBeLessThanOrEqual(1);
}

/** Gera um vídeo .y4m com o QR Code, usado como câmera falsa pelo Chromium. */
function qrVideo(content: string, name: string) {
  const png = path.join(OUT, `${name}.png`);
  const y4m = path.join(OUT, `${name}.y4m`);
  return QRCode.toFile(png, content, { width: 480, margin: 6 }).then(() => {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', png, '-vf', 'pad=640:480:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p', '-t', '2', '-r', '15', y4m]);
    return y4m;
  });
}

async function cameraBrowser(y4m: string): Promise<Browser> {
  return chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`] });
}

test('Cenário 3: coordenação acessa o painel e cadastra escola e evento (desktop)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await login(page, 'coord@e2e.local');
  await expect(page.getByRole('heading', { name: 'Painel gerencial' })).toBeVisible();

  await page.getByRole('link', { name: 'Escolas' }).first().click();
  await page.getByRole('button', { name: 'Nova escola' }).click();
  await page.getByLabel('Nome', { exact: true }).fill('EMEF Professora Maria Teste');
  await page.getByLabel('Unidade administrativa / regional (opcional)', { exact: true }).fill('Regional Norte');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect(page.getByRole('cell', { name: 'EMEF Professora Maria Teste' })).toBeVisible();

  await page.goto('/admin/eventos/novo');
  // Validação: enviar vazio mostra erros compreensíveis
  await page.getByRole('button', { name: 'Salvar evento' }).click();
  await expect(page.getByText('Informe o título.')).toBeVisible();

  await page.getByLabel('Título', { exact: true }).fill('Seminário de Práticas de Alfabetização');
  await page.getByLabel('Descrição', { exact: true }).fill('Encontro formativo para professores dos anos iniciais.');
  await page.getByLabel('Público-alvo', { exact: true }).fill('Professores do 1º ao 3º ano');
  await page.getByLabel('Local', { exact: true }).fill('Auditório da Secretaria');
  await page.getByLabel('Formador(a) ou responsável (quando aplicável)', { exact: true }).fill('Equipe pedagógica');
  await page.getByLabel('Carga horária do evento (h)', { exact: true }).fill('4');
  await page.getByLabel('Número máximo de participantes', { exact: true }).fill('50');
  await page.getByLabel('Abertura das inscrições', { exact: true }).fill(localInput(-60 * 24));
  await page.getByLabel('Prazo final de inscrição', { exact: true }).fill(localInput(60 * 24));
  await page.getByLabel('Situação', { exact: true }).selectOption('publicado');
  await page.getByLabel('Título da sessão 1', { exact: true }).fill('Encontro único');
  await page.getByLabel('Início', { exact: true }).fill(localInput(-15));
  await page.getByLabel('Término', { exact: true }).fill(localInput(225));
  await page.getByLabel('Horas', { exact: true }).fill('4');
  await shot(page, '01-cadastro-evento-desktop');
  await page.getByRole('button', { name: 'Salvar evento' }).click();
  await page.waitForURL(/\/admin\/eventos\/[0-9a-f-]{36}$/);
  state.eventId = page.url().split('/').pop();
  await expect(page.getByRole('heading', { name: 'Seminário de Práticas de Alfabetização' })).toBeVisible();

  // Designa o operador de credenciamento para o evento
  await page.getByRole('tab', { name: 'Equipe de credenciamento' }).click();
  await page.getByLabel(/Otávio Operador/).check();
  await page.getByRole('button', { name: 'Salvar equipe' }).click();
  await expect(page.getByText('Equipe salva.')).toBeVisible();
});

test('Cenários 1, 2 e 11: professor se inscreve pelo celular, vê protocolo e QR Code e recebe o e-mail', async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Inscrições abertas' })).toBeVisible();
  await noHorizontalScroll(page);
  await shot(page, '02-eventos-celular');
  await page.getByRole('link', { name: 'Ver detalhes e inscrever-se' }).first().click();
  await expect(page.getByRole('heading', { name: 'Seminário de Práticas de Alfabetização' })).toBeVisible();

  // Erros de validação no próprio formulário
  await page.getByLabel('CPF', { exact: true }).fill('11111111111');
  await page.getByRole('button', { name: 'Revisar dados' }).click();
  await expect(page.getByText('CPF inválido: confira os dígitos.').first()).toBeVisible();

  await page.getByLabel('Nome completo', { exact: true }).fill('Joana Aparecida da Silva');
  await page.getByLabel('CPF', { exact: true }).fill('52998224725');
  await page.getByLabel('Escola ou instituição em que atua', { exact: true }).selectOption({ label: 'EMEF Professora Maria Teste' });
  await page.getByLabel('E-mail', { exact: true }).fill('joana.silva@e2e.local');
  await page.getByLabel('Telefone com DDD', { exact: true }).fill('48991234567');
  await page.getByRole('checkbox').check();
  await expect(page.getByLabel('CPF', { exact: true })).toHaveValue('529.982.247-25');
  await page.getByRole('button', { name: 'Revisar dados' }).click();

  await expect(page.getByRole('heading', { name: 'Confira seus dados' })).toBeVisible();
  await expect(page.getByText('joana.silva@e2e.local')).toBeVisible();
  await shot(page, '03-revisao-celular');
  await page.getByRole('button', { name: 'Confirmar inscrição' }).click();

  await expect(page.getByRole('heading', { name: 'Inscrição confirmada' })).toBeVisible();
  state.protocol = (await page.locator('strong.font-mono').innerText()).trim();
  expect(state.protocol).toMatch(/^\d{4}-[A-Z2-9]{8}$/);
  await expect(page.getByAltText(/QR Code da inscrição/)).toBeVisible();
  // Estado do e-mail mostrado conforme o resultado real (fila -> enviado pela caixa SMTP local)
  await expect(page.getByText('Enviado', { exact: true })).toBeVisible({ timeout: 20_000 });
  await noHorizontalScroll(page);
  await shot(page, '04-sucesso-celular');

  const link = await page.getByRole('link', { name: /Abrir minha inscrição/ }).getAttribute('href');
  state.token = link!.split('/').pop();
  expect(page.url()).not.toContain('52998224725');

  // E-mail realmente entregue à caixa SMTP local, com protocolo e QR Code, sem o CPF
  const dir = 'test-results/mailbox';
  const mails = readdirSync(dir).map((f) => readFileSync(path.join(dir, f), 'utf8')).filter((m) => m.includes('joana.silva@e2e.local'));
  expect(mails.length).toBe(1);
  expect(mails[0]).toContain(state.protocol!);
  expect(mails[0]).toContain('Content-ID: <qrcode>');
  expect(mails[0]).not.toContain('52998224725');

  // Página da inscrição (link do e-mail) no Android
  const android = await browser.newContext({ ...devices['Pixel 7'], locale: 'pt-BR' });
  const ap = await android.newPage();
  await ap.goto(`/i/${state.token}`);
  await expect(ap.getByText(state.protocol!)).toBeVisible();
  await noHorizontalScroll(ap);
  await shot(ap, '05-comprovante-android');
  await android.close();
  await ctx.close();
});

test('Cenários 4 e 5: operador lê o QR Code pela câmera do celular e a segunda leitura não duplica', async () => {
  const y4m = await qrVideo(`${BASE}/i/${state.token}`, 'qr-participante');
  const b = await cameraBrowser(y4m);
  const ctx = await b.newContext({ ...devices['Pixel 7'], baseURL: BASE, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', permissions: ['camera'] });
  const page = await ctx.newPage();
  await login(page, 'cred@e2e.local');
  // Perfil de credenciamento vai direto para sua função e não vê o menu de gestão
  await expect(page.getByRole('heading', { name: 'Credenciamento' })).toBeVisible();
  await page.getByRole('link', { name: /Encontro único/ }).click();
  await page.getByRole('button', { name: 'Iniciar câmera' }).click();
  const card = page.locator('[data-result]');
  await expect(card).toHaveAttribute('data-result', 'registrado', { timeout: 20_000 });
  await expect(card).toContainText('Joana Aparecida da Silva');
  await expect(card).toContainText('EMEF Professora Maria Teste');
  await expect(card).not.toContainText('529');
  await shot(page, '06-checkin-registrado');
  // O vídeo continua mostrando o mesmo QR: após o intervalo anti-repetição, o servidor responde "já registrado"
  await expect(card).toHaveAttribute('data-result', 'ja_registrado', { timeout: 20_000 });
  await shot(page, '07-checkin-ja-registrado');
  await noHorizontalScroll(page);
  await b.close();

  const db = new pg.Client({ connectionString: E2E_ENV.DATABASE_URL });
  await db.connect();
  const r = await db.query(`SELECT count(*)::int AS n, max(u.email) AS op FROM attendances a JOIN users u ON u.id = a.checked_in_by`);
  await db.end();
  expect(r.rows[0]).toEqual({ n: 1, op: 'cred@e2e.local' });
});

test('Cenário 6: QR Code inválido é recusado pela câmera; câmera negada mostra orientação', async ({ browser }) => {
  const y4m = await qrVideo('https://exemplo.com/nao-e-uma-inscricao', 'qr-invalido');
  const b = await cameraBrowser(y4m);
  const ctx = await b.newContext({ ...devices['iPhone 13'], baseURL: BASE, locale: 'pt-BR', permissions: ['camera'] });
  const page = await ctx.newPage();
  await login(page, 'cred@e2e.local');
  await page.getByRole('link', { name: /Encontro único/ }).click();
  await page.getByRole('button', { name: 'Iniciar câmera' }).click();
  await expect(page.locator('[data-result]')).toHaveAttribute('data-result', 'qr_invalido', { timeout: 20_000 });
  await shot(page, '08-checkin-qr-invalido');
  await b.close();

  // Sem permissão de câmera
  const denied = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--deny-permission-prompts'] });
  const dctx = await denied.newContext({ baseURL: BASE, locale: 'pt-BR' });
  const dp = await dctx.newPage();
  await login(dp, 'cred@e2e.local');
  await dp.getByRole('link', { name: /Encontro único/ }).click();
  await dp.getByRole('button', { name: 'Iniciar câmera' }).click();
  await expect(dp.locator('[data-cam]')).toHaveAttribute('data-cam', /denied|unavailable/);
  await shot(dp, '09-camera-negada');
  await denied.close();
  void browser;
});

test('Cenário 10: perfis sem autorização não acessam funções administrativas', async ({ page }) => {
  await login(page, 'consulta@e2e.local');
  await expect(page.getByRole('heading', { name: 'Painel gerencial' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Eventos' })).toHaveCount(0);
  await page.goto('/admin/configuracoes');
  await expect(page.getByText('Acesso não autorizado')).toBeVisible();
  const api = await page.request.get('/api/admin/settings');
  expect(api.status()).toBe(403);
  await page.goto('/admin/credenciamento');
  await expect(page.getByText('Acesso não autorizado')).toBeVisible();

  const anon = await page.context().browser()!.newContext();
  const ap = await anon.newPage();
  await ap.goto(`${BASE}/admin/eventos`);
  await expect(ap).toHaveURL(/\/admin\/entrar/);
  expect((await ap.request.get(`${BASE}/api/admin/events`)).status()).toBe(401);
  await anon.close();
});

test('Cenários 7 e 9: após o encerramento, só o participante presente recebe certificado; relatório confere', async ({ page, browser }) => {
  // Segunda inscrição que não comparece
  const ctx = await browser.newContext({ locale: 'pt-BR' });
  const p2 = await ctx.newPage();
  await p2.goto(`/eventos/${state.eventId}`);
  await p2.getByLabel('Nome completo', { exact: true }).fill('Pedro Henrique Souza');
  await p2.getByLabel('CPF', { exact: true }).fill('11144477735');
  await p2.getByLabel('Escola ou instituição em que atua', { exact: true }).selectOption('outra');
  await p2.getByLabel('Nome da instituição', { exact: true }).fill('Escola Estadual Exemplo');
  await p2.getByLabel('E-mail', { exact: true }).fill('pedro@e2e.local');
  await p2.getByLabel('Telefone com DDD', { exact: true }).fill('4833334444');
  await p2.getByRole('checkbox').check();
  await p2.getByRole('button', { name: 'Revisar dados' }).click();
  await p2.getByRole('button', { name: 'Confirmar inscrição' }).click();
  await expect(p2.getByRole('heading', { name: 'Inscrição confirmada' })).toBeVisible();
  await ctx.close();

  // Encerra o evento (sessão no passado)
  const db = new pg.Client({ connectionString: E2E_ENV.DATABASE_URL });
  await db.connect();
  await db.query(`UPDATE event_sessions SET starts_at = starts_at - interval '1 day', ends_at = ends_at - interval '1 day' WHERE event_id = $1`, [state.eventId]);

  await page.setViewportSize({ width: 1366, height: 900 });
  await login(page, 'coord@e2e.local');
  await page.goto(`/admin/eventos/${state.eventId}`);
  await page.getByRole('tab', { name: 'Certificados' }).click();
  await page.getByRole('button', { name: 'Autorizar emissão' }).click();
  await page.getByRole('button', { name: /Emitir 1 certificado/ }).click();
  await expect(page.getByText('1 certificado(s) gerado(s)')).toBeVisible();
  await shot(page, '10-certificados');

  const certs = await db.query(`SELECT c.verification_code, p.full_name FROM certificates c JOIN registrations r ON r.id = c.registration_id JOIN participants p ON p.id = r.participant_id`);
  expect(certs.rows.map((r) => r.full_name)).toEqual(['Joana Aparecida da Silva']);
  const code = certs.rows[0].verification_code;

  // Certificado enviado por e-mail, com PDF anexo, somente para a participante presente
  await expect.poll(() => readdirSync('test-results/mailbox').map((f) => readFileSync(path.join('test-results/mailbox', f), 'utf8')).filter((m) => m.includes('application/pdf')).length, { timeout: 20_000 }).toBe(1);
  const certMail = readdirSync('test-results/mailbox').map((f) => readFileSync(path.join('test-results/mailbox', f), 'utf8')).find((m) => m.includes('application/pdf'))!;
  expect(certMail).toContain('joana.silva@e2e.local');

  // Verificação pública pelo celular
  const m = await browser.newContext({ ...devices['iPhone 13'], locale: 'pt-BR' });
  const mp = await m.newPage();
  await mp.goto(`/verificar/${code}`);
  await expect(mp.getByText('Certificado válido')).toBeVisible();
  await expect(mp.getByText('Joana Aparecida da Silva')).toBeVisible();
  await noHorizontalScroll(mp);
  await shot(mp, '11-verificacao-celular');
  const pdf = await mp.request.get(`/api/public/certificates/${code}/pdf`);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  writeFileSync(path.join(OUT, 'certificado-exemplo.pdf'), await pdf.body());
  await m.close();

  // Painel: 2 confirmadas, 1 presente, 1 ausente, 1 certificado
  await page.goto('/admin');
  await page.getByLabel('Evento', { exact: true }).selectOption(state.eventId!);
  const stat = (label: string) => page.locator('.card', { hasText: label }).locator('p.text-2xl').first();
  await expect(stat('Confirmadas')).toHaveText('2');
  await expect(stat('Presentes')).toHaveText('1');
  await expect(stat('Ausentes')).toHaveText('1');
  await expect(stat('Certificados emitidos')).toHaveText('1');
  await expect(stat('Taxa de comparecimento')).toHaveText('50%');
  await shot(page, '12-painel');

  // Exportação PDF da lista de presença
  await page.goto('/admin/relatorios');
  await page.getByLabel('Tipo de relatório', { exact: true }).selectOption('presencas');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Gerar arquivo' }).click()]);
  await dl.saveAs(path.join(OUT, 'lista-presenca.pdf'));
  expect(dl.suggestedFilename()).toMatch(/^presencas-.*\.pdf$/);
  await db.end();
});

test('Cenário 12: dados persistem após sair da conta', async ({ page }) => {
  await login(page, 'coord@e2e.local');
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/admin\/entrar/);
  await login(page, 'coord@e2e.local');
  await page.goto(`/admin/eventos/${state.eventId}`);
  await expect(page.getByText('Joana Aparecida da Silva')).toBeVisible();
  await expect(page.getByText(state.protocol!)).toBeVisible();
});
