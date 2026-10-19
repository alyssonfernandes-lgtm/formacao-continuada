import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../../lib/api';
import { useApp, useTitle } from '../../lib/app';
import { fmtDateTime } from '../../lib/format';
import { Alert, Badge, EmailBadge, Empty, Modal, PageHeader, SelectInput, Spinner, TextArea, TextInput } from '../../components/ui';
import { ROLE_LABELS, type Role } from '../../../shared/types';
import { Icon } from '../../components/Icon';

// ---------------- Fila de e-mails ----------------
interface Msg {
  id: string;
  kind: string;
  to_address: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  next_attempt_at: string;
  sent_at: string | null;
  created_at: string;
  recipient_name: string | null;
  event_title: string | null;
}
const kindLabel: Record<string, string> = { confirmacao: 'Confirmação', certificado: 'Certificado', redefinir_senha: 'Redefinição de senha' };

export function Emails() {
  useTitle('Fila de e-mails');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [data, setData] = useState<{ smtpConfigured: boolean; counts: Record<string, number>; messages: Msg[] } | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const load = useCallback(() => api(`/api/admin/emails?status=${status}&kind=${kind}`).then(setData), [status, kind]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [load]);
  const retry = async (m: Msg) => {
    try {
      await api(`/api/admin/emails/${m.id}/retry`, { method: 'POST' });
      setMsg({ tone: 'success', text: 'Nova tentativa agendada.' });
      await load();
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };
  return (
    <div>
      <PageHeader title="Fila de e-mails" subtitle="Situação real de cada envio, conforme a resposta do servidor de e-mail." />
      {data && !data.smtpConfigured && <div className="mb-4"><Alert tone="warning" title="SMTP não configurado">Os e-mails ficam pendentes até que as variáveis SMTP_HOST e SMTP_FROM sejam configuradas no servidor. Nenhum e-mail é dado como enviado sem confirmação do provedor.</Alert></div>}
      {data && (
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          {['pendente', 'enviando', 'enviado', 'falhou'].map((s) => <span key={s} className="flex items-center gap-1"><EmailBadge status={s} /> {data.counts[s] ?? 0}</span>)}
        </div>
      )}
      <div className="mb-4 grid max-w-xl gap-3 sm:grid-cols-2">
        <SelectInput label="Situação" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todas</option><option value="pendente">Pendente</option><option value="enviando">Enviando</option><option value="enviado">Enviado</option><option value="falhou">Falhou</option>
        </SelectInput>
        <SelectInput label="Tipo" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Todos</option><option value="confirmacao">Confirmação</option><option value="certificado">Certificado</option><option value="redefinir_senha">Redefinição de senha</option>
        </SelectInput>
      </div>
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      {!data ? <Spinner /> : data.messages.length === 0 ? <Empty>Nenhuma mensagem.</Empty> : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Destinatário</th><th>Tipo</th><th>Situação</th><th>Tentativas</th><th>Último erro</th><th>Datas</th><th><span className="sr-only">Ações</span></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.messages.map((m) => (
                <tr key={m.id}>
                  <td className="min-w-[180px]"><div className="font-medium">{m.recipient_name}</div><div className="text-xs text-slate-500">{m.to_address}</div>{m.event_title && <div className="text-xs text-slate-500">{m.event_title}</div>}</td>
                  <td>{kindLabel[m.kind]}</td>
                  <td><EmailBadge status={m.status} /></td>
                  <td className="tabular-nums">{m.attempts}/{m.max_attempts}</td>
                  <td className="max-w-[260px] text-xs text-red-800">{m.last_error}</td>
                  <td className="whitespace-nowrap text-xs">Criado {fmtDateTime(m.created_at)}{m.sent_at && <div>Enviado {fmtDateTime(m.sent_at)}</div>}{m.status === 'pendente' && m.attempts > 0 && <div>Próxima {fmtDateTime(m.next_attempt_at)}</div>}</td>
                  <td>{m.status === 'falhou' && <button className="btn-secondary" onClick={() => retry(m)}><Icon name="refresh" />Tentar de novo</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------- Escolas ----------------
interface School {
  id: string;
  name: string;
  unit: string | null;
  active: boolean;
}
export function Schools() {
  useTitle('Escolas');
  const [rows, setRows] = useState<School[] | null>(null);
  const [edit, setEdit] = useState<Partial<School> | null>(null);
  const [error, setError] = useState('');
  const load = () => api<School[]>('/api/admin/schools').then(setRows);
  useEffect(() => {
    void load();
  }, []);
  const save = async () => {
    setError('');
    try {
      const body = { name: edit!.name ?? '', unit: edit!.unit ?? '', active: edit!.active ?? true };
      if (edit!.id) await api(`/api/admin/schools/${edit!.id}`, { method: 'PUT', body });
      else await api('/api/admin/schools', { body });
      setEdit(null);
      await load();
    } catch (e) {
      setError((e as ApiError).fields?.name ?? (e as Error).message);
    }
  };
  return (
    <div className="max-w-3xl">
      <PageHeader title="Escolas e instituições" subtitle="Lista exibida no formulário de inscrição. Desative em vez de excluir para preservar o histórico." actions={<button className="btn-primary" onClick={() => setEdit({ active: true })}><Icon name="plus" />Nova escola</button>} />
      {!rows ? <Spinner /> : rows.length === 0 ? <Empty>Nenhuma escola cadastrada. Sem escolas, o formulário pede o nome da instituição em texto livre.</Empty> : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Nome</th><th>Unidade administrativa</th><th>Situação</th><th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((s) => (
                <tr key={s.id}><td className="font-medium">{s.name}</td><td>{s.unit ?? '—'}</td><td>{s.active ? <Badge color="green">Ativa</Badge> : <Badge>Inativa</Badge>}</td><td className="text-right"><button className="btn-ghost" onClick={() => setEdit(s)}>Editar</button></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <Modal open title={edit.id ? 'Editar escola' : 'Nova escola'} onClose={() => setEdit(null)} footer={<><button className="btn-secondary" onClick={() => setEdit(null)}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar</button></>}>
          <div className="grid gap-3">
            <TextInput label="Nome" required value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} error={error} />
            <TextInput label="Unidade administrativa / regional (opcional)" value={edit.unit ?? ''} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Ativa</label>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------- Usuários ----------------
interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  last_login_at: string | null;
  locked: boolean;
}
export function Users() {
  useTitle('Usuários');
  const { me } = useApp();
  const [rows, setRows] = useState<User[] | null>(null);
  const [edit, setEdit] = useState<(Partial<User> & { password?: string }) | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const load = () => api<User[]>('/api/admin/users').then(setRows);
  useEffect(() => {
    void load();
  }, []);
  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setErrors({});
    setError('');
    try {
      const body = { name: edit!.name ?? '', email: edit!.email ?? '', role: edit!.role ?? 'coordenacao', active: edit!.active ?? true, password: edit!.password ?? '' };
      if (edit!.id) await api(`/api/admin/users/${edit!.id}`, { method: 'PUT', body });
      else await api('/api/admin/users', { body });
      setEdit(null);
      await load();
    } catch (err) {
      setErrors((err as ApiError).fields ?? {});
      setError((err as Error).message);
    }
  };
  return (
    <div className="max-w-5xl">
      <PageHeader title="Usuários e permissões" actions={<button className="btn-primary" onClick={() => setEdit({ role: 'coordenacao', active: true })}><Icon name="plus" />Novo usuário</button>} />
      <div className="mb-4 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
        <p><strong>Administrador:</strong> configurações, usuários e todas as funções.</p>
        <p><strong>Coordenação pedagógica:</strong> eventos, inscrições, credenciamento, certificados e relatórios.</p>
        <p><strong>Equipe de credenciamento:</strong> apenas leitura de QR Code nos eventos designados.</p>
        <p><strong>Consulta gerencial:</strong> painel e resumo consolidado, sem dados pessoais.</p>
      </div>
      {!rows ? <Spinner /> : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Nome</th><th>Perfil</th><th>Situação</th><th>Último acesso</th><th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((u) => (
                <tr key={u.id}>
                  <td><div className="font-medium">{u.name}</div><div className="text-xs text-slate-500">{u.email}</div></td>
                  <td>{ROLE_LABELS[u.role]}</td>
                  <td>{!u.active ? <Badge>Inativo</Badge> : u.locked ? <Badge color="amber">Bloqueado</Badge> : <Badge color="green">Ativo</Badge>}</td>
                  <td className="whitespace-nowrap">{fmtDateTime(u.last_login_at)}</td>
                  <td className="text-right"><button className="btn-ghost" onClick={() => setEdit(u)}>Editar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <Modal open title={edit.id ? 'Editar usuário' : 'Novo usuário'} onClose={() => setEdit(null)} footer={<><button className="btn-secondary" onClick={() => setEdit(null)}>Cancelar</button><button className="btn-primary" onClick={() => save()}>Salvar</button></>}>
          <form onSubmit={save} className="grid gap-3">
            {error && <Alert tone="error">{error}</Alert>}
            <TextInput label="Nome" required value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} error={errors.name} />
            <TextInput label="E-mail" type="email" required value={edit.email ?? ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} error={errors.email} />
            <SelectInput label="Perfil" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as Role })} disabled={edit.id === me?.id}>
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </SelectInput>
            <TextInput label={edit.id ? 'Nova senha (deixe vazio para manter)' : 'Senha inicial'} type="password" autoComplete="new-password" value={edit.password ?? ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} error={errors.password} hint="Mínimo de 12 caracteres, com letras e números. Oriente a pessoa a trocá-la no primeiro acesso." />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={edit.active ?? true} disabled={edit.id === me?.id} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Ativo</label>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ---------------- Configurações institucionais ----------------
export function SettingsPage() {
  useTitle('Configurações');
  const { reloadSettings } = useApp();
  const [s, setS] = useState<Record<string, string | number | boolean | null> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  useEffect(() => {
    api('/api/admin/settings').then(setS);
  }, []);
  if (!s) return <Spinner />;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setS({ ...s, [k]: e.target.value });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    try {
      const { hasLogo, logoVersion, ...body } = s; // eslint-disable-line @typescript-eslint/no-unused-vars
      setS(await api('/api/admin/settings', { method: 'PUT', body }));
      await reloadSettings();
      setMsg({ tone: 'success', text: 'Configurações salvas.' });
    } catch (err) {
      setErrors((err as ApiError).fields ?? {});
      setMsg({ tone: 'error', text: (err as Error).message });
    }
  };
  const uploadLogo = async (file: File) => {
    if (!['image/png', 'image/jpeg'].includes(file.type)) return setMsg({ tone: 'error', text: 'Use PNG ou JPEG (o PDF do certificado aceita apenas esses formatos).' });
    if (file.size > 2 * 1024 * 1024) return setMsg({ tone: 'error', text: 'A imagem deve ter até 2 MB.' });
    const data = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.readAsDataURL(file);
    });
    try {
      setS(await api('/api/admin/settings/logo', { method: 'PUT', body: { mime: file.type, data } }));
      await reloadSettings();
      setMsg({ tone: 'success', text: 'Logo atualizada.' });
    } catch (err) {
      setMsg({ tone: 'error', text: (err as Error).message });
    }
  };
  const removeLogo = async () => {
    setS(await api('/api/admin/settings/logo', { method: 'DELETE' }));
    await reloadSettings();
  };
  const v = (k: string) => String(s[k] ?? '');
  return (
    <form onSubmit={save} className="max-w-4xl">
      <PageHeader title="Configurações institucionais" />
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <fieldset className="card grid gap-4 p-5 sm:grid-cols-2">
        <legend className="px-1 text-base font-semibold">Identidade</legend>
        <div className="sm:col-span-2"><TextInput label="Nome da plataforma" value={v('platformName')} onChange={set('platformName')} error={errors.platformName} /></div>
        <TextInput label="Município" value={v('municipality')} onChange={set('municipality')} />
        <TextInput label="Secretaria / órgão" value={v('department')} onChange={set('department')} />
        <TextInput label="Cor principal" type="color" value={v('primaryColor')} onChange={set('primaryColor')} error={errors.primaryColor} hint="O texto sobre a cor é ajustado automaticamente para manter contraste." />
        <TextInput label="Cor secundária" type="color" value={v('secondaryColor')} onChange={set('secondaryColor')} error={errors.secondaryColor} />
        <div className="sm:col-span-2">
          <p className="label">Logo oficial</p>
          <div className="flex flex-wrap items-center gap-3">
            {s.hasLogo ? <img src={`/api/public/logo?v=${s.logoVersion}`} alt="Logo atual" className="h-16 rounded bg-slate-100 p-1" /> : <span className="text-sm text-slate-600">Nenhuma logo enviada: o sistema exibe um espaço reservado neutro.</span>}
            <label className="btn-secondary cursor-pointer">Enviar PNG ou JPEG<input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} /></label>
            {s.hasLogo && <button type="button" className="btn-ghost text-red-700" onClick={removeLogo}>Remover</button>}
          </div>
          <p className="mt-1 text-xs text-slate-600">Use somente a logo oficial fornecida pela Prefeitura, conforme o manual de marca.</p>
        </div>
      </fieldset>
      <fieldset className="card mt-6 grid gap-4 p-5 sm:grid-cols-2">
        <legend className="px-1 text-base font-semibold">Assinatura padrão dos certificados</legend>
        <TextInput label="Nome de quem assina" value={v('defaultSignerName')} onChange={set('defaultSignerName')} hint="Usado quando o evento não define outro signatário." />
        <TextInput label="Cargo" value={v('defaultSignerRole')} onChange={set('defaultSignerRole')} />
      </fieldset>
      <fieldset className="card mt-6 grid gap-4 p-5 sm:grid-cols-2">
        <legend className="px-1 text-base font-semibold">Contato (exibido no site, nos e-mails e no aviso de privacidade)</legend>
        <TextInput label="E-mail de contato" value={v('contactEmail')} onChange={set('contactEmail')} />
        <TextInput label="Telefone" value={v('contactPhone')} onChange={set('contactPhone')} />
        <div className="sm:col-span-2"><TextInput label="Endereço" value={v('contactAddress')} onChange={set('contactAddress')} /></div>
      </fieldset>
      <fieldset className="card mt-6 grid gap-4 p-5 sm:grid-cols-2">
        <legend className="px-1 text-base font-semibold">Proteção de dados (LGPD)</legend>
        <div className="sm:col-span-2"><TextInput label="Controlador" value={v('controllerName')} onChange={set('controllerName')} hint="Ex.: Prefeitura Municipal de ..., por meio da Secretaria Municipal de Educação" /></div>
        <TextInput label="Encarregado (DPO)" value={v('dpoName')} onChange={set('dpoName')} />
        <TextInput label="Contato do encarregado" value={v('dpoContact')} onChange={set('dpoContact')} />
        <div className="sm:col-span-2"><TextArea label="Texto adicional do aviso de privacidade" value={v('privacyExtra')} onChange={set('privacyExtra')} /></div>
        <TextInput label="Descartar inscrições canceladas após (dias)" inputMode="numeric" value={v('retentionCancelledDays')} onChange={set('retentionCancelledDays')} error={errors.retentionCancelledDays} />
        <TextInput label="Descartar histórico de e-mails após (dias)" inputMode="numeric" value={v('retentionEmailDays')} onChange={set('retentionEmailDays')} error={errors.retentionEmailDays} />
      </fieldset>
      <fieldset className="card mt-6 grid gap-4 p-5 sm:grid-cols-3">
        <legend className="px-1 text-base font-semibold">Credenciamento e horário</legend>
        <TextInput label="Fuso horário" value={v('timezone')} onChange={set('timezone')} error={errors.timezone} hint="Padrão IANA, ex.: America/Sao_Paulo" />
        <TextInput label="Abrir credenciamento (min antes)" inputMode="numeric" value={v('checkinBeforeMinutes')} onChange={set('checkinBeforeMinutes')} />
        <TextInput label="Manter aberto (min após o término)" inputMode="numeric" value={v('checkinAfterMinutes')} onChange={set('checkinAfterMinutes')} />
      </fieldset>
      <div className="mt-6"><button className="btn-primary">Salvar configurações</button></div>
    </form>
  );
}

// ---------------- Auditoria ----------------
interface Log {
  id: number;
  at: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  user_name: string | null;
}
export function Audit() {
  useTitle('Auditoria');
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [rows, setRows] = useState<Log[] | null>(null);
  useEffect(() => {
    api<Log[]>(`/api/admin/audit?page=${page}&action=${encodeURIComponent(action)}`).then(setRows);
  }, [page, action]);
  return (
    <div>
      <PageHeader title="Registro de auditoria" subtitle="Operações administrativas relevantes. Os detalhes não incluem CPF, telefone ou tokens." />
      <div className="mb-4 max-w-sm">
        <SelectInput label="Ação" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
          <option value="">Todas</option>
          <option value="evento">Eventos</option><option value="inscricao">Inscrições</option><option value="presenca">Presenças</option>
          <option value="certificado">Certificados</option><option value="relatorio">Exportações</option><option value="usuario">Usuários</option>
          <option value="login">Logins</option><option value="configuracoes">Configurações</option>
        </SelectInput>
      </div>
      {!rows ? <Spinner /> : rows.length === 0 ? <Empty>Nenhum registro.</Empty> : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Detalhes</th><th>IP</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(r.at)}</td>
                  <td>{r.user_name ?? '—'}</td>
                  <td className="font-mono text-xs">{r.action}</td>
                  <td className="max-w-md break-words font-mono text-xs text-slate-600">{Object.keys(r.details ?? {}).length ? JSON.stringify(r.details) : ''}{r.entity_id && <div>{r.entity_type}: {r.entity_id}</div>}</td>
                  <td className="text-xs">{r.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <button className="btn-secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Anterior</button>
        <button className="btn-secondary" disabled={(rows?.length ?? 0) < 100} onClick={() => setPage(page + 1)}>Próxima</button>
      </div>
    </div>
  );
}
