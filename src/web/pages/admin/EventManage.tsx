import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useApp, useTitle } from '../../lib/app';
import { fmtDate, fmtDateTime, fmtHours, fmtTime } from '../../lib/format';
import type { EventDto } from '../../lib/types';
import { Alert, Badge, EmailBadge, Empty, Modal, PageHeader, PhaseBadge, SelectInput, Spinner, Stat, TextArea, TextInput } from '../../components/ui';
import { ReasonDialog } from '../../components/ReasonDialog';
import { Icon } from '../../components/Icon';

type Tab = 'inscricoes' | 'presencas' | 'certificados' | 'equipe';

export function EventManage() {
  const { id } = useParams();
  const { can } = useApp();
  const [ev, setEv] = useState<EventDto | null>(null);
  const [tab, setTab] = useState<Tab>('inscricoes');
  const [error, setError] = useState('');
  useTitle(ev?.title ?? 'Evento');
  const load = useCallback(() => api<EventDto>(`/api/admin/events/${id}`).then(setEv).catch((e: ApiError) => setError(e.message)), [id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!ev) return <Spinner />;
  const tabs: [Tab, string, boolean][] = [
    ['inscricoes', 'Inscrições', can('registrations.view')],
    ['presencas', 'Presenças', can('registrations.view')],
    ['certificados', 'Certificados', can('certificates.manage')],
    ['equipe', 'Equipe de credenciamento', can('events.manage')],
  ];
  return (
    <div>
      <Link to="/admin/eventos" className="text-sm text-slate-600 underline">← Eventos</Link>
      <PageHeader
        title={ev.title}
        subtitle={<span className="flex flex-wrap items-center gap-2"><PhaseBadge phase={ev.phase} /> {ev.startsAt && `${fmtDate(ev.startsAt)} · `}{ev.location} · {fmtHours(ev.workloadHours)}</span>}
        actions={
          <>
            {ev.status === 'publicado' && <a className="btn-secondary" href={`/eventos/${ev.id}`} target="_blank" rel="noopener">Ver página pública</a>}
            {can('events.manage') && <Link className="btn-primary" to={`/admin/eventos/${ev.id}/editar`}>Editar</Link>}
          </>
        }
      />
      <div role="tablist" aria-label="Seções do evento" className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
        {tabs.filter((t) => t[2]).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium ${tab === k ? 'border-primary text-primary' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'inscricoes' && <Registrations ev={ev} />}
        {tab === 'presencas' && <Attendances ev={ev} />}
        {tab === 'certificados' && <Certificates ev={ev} reload={load} />}
        {tab === 'equipe' && <Staff ev={ev} />}
      </div>
    </div>
  );
}

interface RegRow {
  id: string;
  protocol: string;
  status: string;
  created_at: string;
  full_name: string;
  cpf_masked: string;
  email: string;
  phone: string;
  school: string;
  attended_sessions: number;
  total_sessions: number;
  attendance_percent: number;
  meets_criterion: boolean;
  email_status: string | null;
  certificate_number: string | null;
  cancel_reason: string | null;
}

function Registrations({ ev }: { ev: EventDto }) {
  const { can } = useApp();
  const [rows, setRows] = useState<RegRow[] | null>(null);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [dialog, setDialog] = useState<{ kind: 'cancel' | 'rotate'; row: RegRow } | null>(null);
  const load = useCallback(() => api<RegRow[]>(`/api/admin/events/${ev.id}/registrations?q=${encodeURIComponent(q)}`).then(setRows), [ev.id, q]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);
  const resend = async (r: RegRow) => {
    try {
      await api(`/api/admin/registrations/${r.id}/resend-confirmation`, { method: 'POST' });
      setMsg({ tone: 'success', text: `Reenvio da confirmação de ${r.full_name} colocado na fila.` });
      void load();
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };
  const confirmed = rows?.filter((r) => r.status === 'confirmada').length ?? 0;
  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Confirmadas" value={confirmed} />
        <Stat label="Canceladas" value={(rows?.length ?? 0) - confirmed} />
        <Stat label="Vagas" value={ev.capacity ?? 'Sem limite'} />
        <Stat label="E-mails com falha" value={rows?.filter((r) => r.email_status === 'falhou').length ?? 0} />
      </div>
      <div className="mb-4 max-w-sm"><TextInput label="Buscar por nome ou protocolo" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      {!rows ? <Spinner /> : rows.length === 0 ? <Empty>Nenhuma inscrição encontrada.</Empty> : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Participante</th><th>Escola</th><th>Contato</th><th>Situação</th><th>Frequência</th><th>E-mail</th><th><span className="sr-only">Ações</span></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="min-w-[200px]"><div className="font-medium">{r.full_name}</div><div className="font-mono text-xs text-slate-500">{r.protocol} · CPF {r.cpf_masked}</div></td>
                  <td className="min-w-[160px]">{r.school}</td>
                  <td className="text-xs"><div>{r.email}</div><div>{r.phone}</div></td>
                  <td>{r.status === 'confirmada' ? <Badge color="green">Confirmada</Badge> : <span title={r.cancel_reason ?? ''}><Badge color="red">Cancelada</Badge></span>}</td>
                  <td className="whitespace-nowrap">{r.attended_sessions}/{r.total_sessions} ({r.attendance_percent}%)</td>
                  <td><EmailBadge status={r.email_status} /></td>
                  <td className="whitespace-nowrap text-right">
                    {can('registrations.manage') && r.status === 'confirmada' && (
                      <>
                        <button className="btn-ghost" onClick={() => resend(r)}>Reenviar</button>
                        <button className="btn-ghost" onClick={() => setDialog({ kind: 'rotate', row: r })}>Novo QR</button>
                        <button className="btn-ghost text-red-700" onClick={() => setDialog({ kind: 'cancel', row: r })}>Cancelar</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog?.kind === 'cancel' && (
        <ReasonDialog title="Cancelar inscrição" danger confirmLabel="Cancelar inscrição" description={`${dialog.row.full_name} (${dialog.row.protocol}). O QR Code deixará de ser aceito no credenciamento.`} onClose={() => setDialog(null)}
          onConfirm={async (reason) => { await api(`/api/admin/registrations/${dialog.row.id}/cancel`, { body: { reason } }); setMsg({ tone: 'success', text: 'Inscrição cancelada.' }); await load(); }} />
      )}
      {dialog?.kind === 'rotate' && (
        <ReasonDialog title="Gerar novo QR Code" confirmLabel="Gerar e reenviar" description={`O QR Code atual de ${dialog.row.full_name} será invalidado imediatamente e um novo será enviado por e-mail.`} onClose={() => setDialog(null)}
          onConfirm={async (reason) => { await api(`/api/admin/registrations/${dialog.row.id}/rotate-qr`, { body: { reason } }); setMsg({ tone: 'success', text: 'Novo QR Code gerado e e-mail colocado na fila.' }); await load(); }} />
      )}
    </div>
  );
}

interface AttRow {
  id: string;
  registration_id: string;
  session_id: string;
  checked_in_at: string;
  method: string;
  justification: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  operator: string;
  revoked_by_name: string | null;
  full_name: string;
  protocol: string;
  school: string;
}

function Attendances({ ev }: { ev: EventDto }) {
  const { can } = useApp();
  const [rows, setRows] = useState<AttRow[] | null>(null);
  const [regs, setRegs] = useState<RegRow[]>([]);
  const [session, setSession] = useState(ev.sessions[0]?.id ?? '');
  const [revoke, setRevoke] = useState<AttRow | null>(null);
  const [add, setAdd] = useState(false);
  const load = useCallback(() => api<AttRow[]>(`/api/admin/events/${ev.id}/attendances`).then(setRows), [ev.id]);
  useEffect(() => {
    void load();
    api<RegRow[]>(`/api/admin/events/${ev.id}/registrations`).then(setRegs);
  }, [load, ev.id]);
  const list = rows?.filter((r) => !session || r.session_id === session) ?? [];
  const method: Record<string, string> = { qrcode: 'QR Code', manual: 'Busca manual', correcao: 'Correção' };
  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-80">
          <SelectInput label="Sessão" value={session} onChange={(e) => setSession(e.target.value)}>
            <option value="">Todas</option>
            {ev.sessions.map((s, i) => <option key={s.id} value={s.id}>{s.title || `Sessão ${i + 1}`} · {fmtDate(s.startsAt)} {fmtTime(s.startsAt)}</option>)}
          </SelectInput>
        </div>
        {can('attendance.correct') && <button className="btn-secondary" onClick={() => setAdd(true)}><Icon name="plus" />Incluir presença (correção)</button>}
      </div>
      {!rows ? <Spinner /> : list.length === 0 ? <Empty>Nenhuma presença registrada.</Empty> : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Participante</th><th>Escola</th><th>Check-in</th><th>Operador</th><th>Método</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((r) => (
                <tr key={r.id} className={r.revoked_at ? 'opacity-60' : ''}>
                  <td><div className="font-medium">{r.full_name}</div><div className="font-mono text-xs text-slate-500">{r.protocol}</div></td>
                  <td>{r.school}</td>
                  <td className="whitespace-nowrap">{fmtDateTime(r.checked_in_at)}</td>
                  <td>{r.operator}</td>
                  <td>{method[r.method]}{r.justification && <div className="text-xs text-slate-500">{r.justification}</div>}</td>
                  <td>{r.revoked_at ? <span><Badge color="red">Anulada</Badge><div className="text-xs text-slate-500">{r.revoke_reason} ({r.revoked_by_name})</div></span> : <Badge color="green">Válida</Badge>}</td>
                  <td className="text-right">{can('attendance.correct') && !r.revoked_at && <button className="btn-ghost text-red-700" onClick={() => setRevoke(r)}>Anular</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {revoke && <ReasonDialog title="Anular presença" danger confirmLabel="Anular" description={`${revoke.full_name}, check-in de ${fmtDateTime(revoke.checked_in_at)}.`} onClose={() => setRevoke(null)} onConfirm={async (reason) => { await api(`/api/admin/attendances/${revoke.id}/revoke`, { body: { reason } }); await load(); }} />}
      {add && <AddAttendance ev={ev} regs={regs.filter((r) => r.status === 'confirmada')} onClose={() => setAdd(false)} onDone={load} />}
    </div>
  );
}

function AddAttendance({ ev, regs, onClose, onDone }: { ev: EventDto; regs: RegRow[]; onClose: () => void; onDone: () => Promise<unknown> }) {
  const [registrationId, setReg] = useState('');
  const [sessionId, setSession] = useState(ev.sessions[0]?.id ?? '');
  const [justification, setJ] = useState('');
  const [error, setError] = useState('');
  const go = async () => {
    try {
      await api('/api/admin/attendances', { body: { registrationId, sessionId, justification } });
      await onDone();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal open title="Incluir presença por correção" onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={go} disabled={!registrationId || !sessionId}>Incluir</button></>}>
      <div className="grid gap-3">
        {error && <Alert tone="error">{error}</Alert>}
        <SelectInput label="Participante" value={registrationId} onChange={(e) => setReg(e.target.value)}>
          <option value="">Selecione…</option>
          {regs.map((r) => <option key={r.id} value={r.id}>{r.full_name} ({r.protocol})</option>)}
        </SelectInput>
        <SelectInput label="Sessão" value={sessionId} onChange={(e) => setSession(e.target.value)}>
          {ev.sessions.map((s, i) => <option key={s.id} value={s.id}>{s.title || `Sessão ${i + 1}`} · {fmtDate(s.startsAt)}</option>)}
        </SelectInput>
        <TextArea label="Justificativa" required value={justification} onChange={(e) => setJ(e.target.value)} hint="Ex.: falha no leitor, presença confirmada em lista assinada." />
      </div>
    </Modal>
  );
}

interface EligRow {
  registration_id: string;
  full_name: string;
  school: string;
  attended_sessions: number;
  total_sessions: number;
  attendance_percent: number;
  meets_criterion: boolean;
  certifiable_hours: number;
  certificate_id: string | null;
  certificate_number: string | null;
  issued_at: string | null;
  email_status: string | null;
}

function Certificates({ ev, reload }: { ev: EventDto; reload: () => Promise<unknown> }) {
  const [rows, setRows] = useState<EligRow[] | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [dialog, setDialog] = useState<{ kind: 'reissue' | 'revoke'; row: EligRow } | null>(null);
  const load = useCallback(() => api<EligRow[]>(`/api/admin/events/${ev.id}/certificates`).then(setRows), [ev.id]);
  useEffect(() => {
    void load();
  }, [load]);
  const ended = ev.endsAt ? new Date(ev.endsAt) < new Date() : false;
  const eligible = rows?.filter((r) => r.meets_criterion) ?? [];
  const pending = eligible.filter((r) => !r.certificate_id);
  const criterion = ev.certCriterion === 'percentual_minimo' ? `frequência mínima de ${ev.certMinPercent}% da carga das sessões (${ev.certHoursMode === 'proporcional' ? 'carga proporcional' : 'carga integral'})` : 'presença em todas as sessões';
  const release = async () => {
    try {
      const r = await api(`/api/admin/events/${ev.id}/certificates/release`, { method: 'POST' });
      setMsg({ tone: 'success', text: `${r.created} certificado(s) gerado(s) e colocados na fila de envio.` });
      await Promise.all([load(), reload()]);
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    } finally {
      setConfirm(false);
    }
  };
  const resend = async (r: EligRow) => {
    try {
      await api(`/api/admin/certificates/${r.certificate_id}/resend`, { method: 'POST' });
      setMsg({ tone: 'success', text: 'Reenvio colocado na fila.' });
      await load();
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };
  return (
    <div>
      <Alert tone="info" title="Critério deste evento">Certificado para inscrições confirmadas com {criterion}. A inscrição sozinha não gera certificado.</Alert>
      <div className="my-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Inscrições confirmadas" value={rows?.length ?? '—'} />
        <Stat label="Elegíveis" value={eligible.length} />
        <Stat label="Emitidos" value={eligible.length - pending.length} />
        <Stat label="Pendentes de emissão" value={ended ? pending.length : '—'} />
      </div>
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={!ended || (Boolean(ev.certificatesReleasedAt) && pending.length === 0)} onClick={() => setConfirm(true)}>
          <Icon name="award" />{ev.certificatesReleasedAt ? 'Emitir pendentes' : 'Autorizar emissão'}
        </button>
        {!ended && <span className="text-sm text-slate-600">A emissão fica disponível após o término da última sessão ({ev.endsAt ? fmtDateTime(ev.endsAt) : 'sem sessões'}).</span>}
        {ev.certificatesReleasedAt && <span className="text-sm text-slate-600">Emissão autorizada em {fmtDateTime(ev.certificatesReleasedAt)}.</span>}
      </div>
      {!rows ? <Spinner /> : rows.length === 0 ? <Empty>Nenhuma inscrição confirmada.</Empty> : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Participante</th><th>Frequência</th><th>Elegível</th><th>Certificado</th><th>E-mail</th><th><span className="sr-only">Ações</span></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.registration_id}>
                  <td><div className="font-medium">{r.full_name}</div><div className="text-xs text-slate-500">{r.school}</div></td>
                  <td className="whitespace-nowrap">{r.attended_sessions}/{r.total_sessions} sessões ({r.attendance_percent}%)</td>
                  <td>{r.meets_criterion ? <Badge color="green">Sim · {fmtHours(r.certifiable_hours)}</Badge> : <Badge>Não</Badge>}</td>
                  <td className="whitespace-nowrap">{r.certificate_number ? <><span className="font-mono">{r.certificate_number}</span><div className="text-xs text-slate-500">{fmtDate(r.issued_at)}</div></> : '—'}</td>
                  <td>{r.certificate_id ? <EmailBadge status={r.email_status} /> : '—'}</td>
                  <td className="whitespace-nowrap text-right">
                    {r.certificate_id && (
                      <>
                        <a className="btn-ghost" href={`/api/admin/certificates/${r.certificate_id}/pdf`} target="_blank" rel="noopener">PDF</a>
                        <button className="btn-ghost" onClick={() => resend(r)}>Reenviar</button>
                        <button className="btn-ghost" onClick={() => setDialog({ kind: 'reissue', row: r })}>Reemitir</button>
                        <button className="btn-ghost text-red-700" onClick={() => setDialog({ kind: 'revoke', row: r })}>Revogar</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={confirm} title="Autorizar emissão de certificados" onClose={() => setConfirm(false)} footer={<><button className="btn-secondary" onClick={() => setConfirm(false)}>Cancelar</button><button className="btn-primary" onClick={release}>Emitir {pending.length} certificado(s)</button></>}>
        <p>Serão gerados certificados apenas para as {pending.length} inscrições que cumprem o critério e ainda não têm certificado. Cada participante receberá o PDF por e-mail.</p>
      </Modal>
      {dialog?.kind === 'reissue' && <ReasonDialog title="Reemitir certificado" confirmLabel="Reemitir" description="O certificado atual será marcado como substituído (continua no histórico e na verificação pública) e um novo será gerado com os dados atuais e enviado por e-mail." onClose={() => setDialog(null)} onConfirm={async (reason) => { await api(`/api/admin/certificates/${dialog.row.certificate_id}/reissue`, { body: { reason } }); await load(); }} />}
      {dialog?.kind === 'revoke' && <ReasonDialog title="Revogar certificado" danger confirmLabel="Revogar" description="A verificação pública passará a informar que o documento não é válido." onClose={() => setDialog(null)} onConfirm={async (reason) => { await api(`/api/admin/certificates/${dialog.row.certificate_id}/revoke`, { body: { reason } }); await load(); }} />}
    </div>
  );
}

function Staff({ ev }: { ev: EventDto }) {
  const [users, setUsers] = useState<{ id: string; name: string; email: string; role: string; active: boolean }[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    api(`/api/admin/users`).then((u) => setUsers(u.filter((x: { role: string; active: boolean }) => x.role === 'credenciamento' && x.active)));
    api<string[]>(`/api/admin/events/${ev.id}/staff`).then(setSelected);
  }, [ev.id]);
  const save = async () => {
    await api(`/api/admin/events/${ev.id}/staff`, { method: 'PUT', body: { userIds: selected } });
    setMsg('Equipe salva.');
  };
  if (!users) return <Spinner />;
  return (
    <div className="max-w-xl">
      <p className="mb-4 text-sm text-slate-600">Usuários com perfil “Equipe de credenciamento” só conseguem registrar presenças nos eventos marcados aqui. Coordenação e administradores credenciam qualquer evento.</p>
      {users.length === 0 ? <Empty>Nenhum usuário com perfil de credenciamento ativo.</Empty> : (
        <fieldset className="card divide-y divide-slate-100">
          <legend className="sr-only">Operadores</legend>
          {users.map((u) => (
            <label key={u.id} className="flex items-center gap-3 px-4 py-3">
              <input type="checkbox" className="h-5 w-5" checked={selected.includes(u.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, u.id] : selected.filter((x) => x !== u.id))} />
              <span><span className="font-medium">{u.name}</span><span className="block text-xs text-slate-500">{u.email}</span></span>
            </label>
          ))}
        </fieldset>
      )}
      {msg && <div className="mt-3"><Alert tone="success">{msg}</Alert></div>}
      <button className="btn-primary mt-4" onClick={save}>Salvar equipe</button>
    </div>
  );
}
