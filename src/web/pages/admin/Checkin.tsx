import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import jsQR from 'jsqr';
import { api, ApiError } from '../../lib/api';
import { useTitle } from '../../lib/app';
import { fmtDate, fmtTime } from '../../lib/format';
import { Alert, Badge, Empty, PageHeader, PhaseBadge, Spinner, TextInput } from '../../components/ui';
import { Icon, type IconName } from '../../components/Icon';
import type { CheckinResult, EventPhase } from '../../../shared/types';

interface CheckinEvent {
  id: string;
  title: string;
  location: string;
  phase: EventPhase;
  sessions: { id: string; title: string; startsAt: string; endsAt: string; open: boolean }[];
}

export function CheckinSelect() {
  useTitle('Credenciamento');
  const [events, setEvents] = useState<CheckinEvent[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<CheckinEvent[]>('/api/admin/checkin/events').then(setEvents).catch((e: ApiError) => setError(e.message));
  }, []);
  const withOpen = events?.filter((e) => e.sessions.some((s) => s.open)) ?? [];
  const others = events?.filter((e) => !e.sessions.some((s) => s.open)) ?? [];
  return (
    <div className="max-w-3xl">
      <PageHeader title="Credenciamento" subtitle="Escolha o evento e a sessão em andamento para ler os QR Codes." />
      {error && <Alert tone="error">{error}</Alert>}
      {!events && !error && <Spinner />}
      {events && withOpen.length === 0 && <Empty>Nenhuma sessão com credenciamento aberto agora. O credenciamento abre próximo ao horário de cada sessão.</Empty>}
      <div className="grid gap-4">
        {withOpen.map((e) => (
          <div key={e.id} className="card p-4">
            <div className="flex flex-wrap items-center gap-2"><PhaseBadge phase={e.phase} /></div>
            <h2 className="mt-2 font-semibold">{e.title}</h2>
            <p className="text-sm text-slate-600">{e.location}</p>
            <div className="mt-3 grid gap-2">
              {e.sessions.filter((s) => s.open).map((s, i) => (
                <Link key={s.id} to={`/admin/credenciamento/${e.id}/${s.id}`} className="btn-primary justify-between">
                  <span>{s.title || `Sessão ${i + 1}`} · {fmtDate(s.startsAt)} {fmtTime(s.startsAt)}–{fmtTime(s.endsAt)}</span>
                  <Icon name="qr" />
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      {others.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Outros eventos autorizados ({others.length})</summary>
          <ul className="mt-3 grid gap-2 text-sm">
            {others.map((e) => <li key={e.id} className="card p-3">{e.title} <span className="text-slate-500">· próxima sessão: {e.sessions.find((s) => new Date(s.endsAt) > new Date()) ? fmtDate(e.sessions.find((s) => new Date(s.endsAt) > new Date())!.startsAt) : 'encerrado'}</span></li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

interface Result {
  result: CheckinResult | 'falha_conexao';
  message: string;
  participant?: { name: string; school: string; protocol: string };
  checkedInAt?: string;
  checkedInBy?: string;
  otherEvent?: string;
}

const style: Record<string, { cls: string; icon: IconName; title: string }> = {
  registrado: { cls: 'bg-emerald-600 text-white', icon: 'check', title: 'Presença registrada' },
  ja_registrado: { cls: 'bg-amber-400 text-slate-900', icon: 'alert', title: 'Já registrado' },
  qr_invalido: { cls: 'bg-red-700 text-white', icon: 'x', title: 'QR Code inválido' },
  inscricao_cancelada: { cls: 'bg-red-700 text-white', icon: 'ban', title: 'Inscrição cancelada' },
  nao_localizada: { cls: 'bg-red-700 text-white', icon: 'search', title: 'Inscrição não localizada' },
  outro_evento: { cls: 'bg-red-700 text-white', icon: 'x', title: 'QR Code de outro evento' },
  evento_nao_autorizado: { cls: 'bg-red-700 text-white', icon: 'shield', title: 'Evento não autorizado' },
  fora_da_janela: { cls: 'bg-red-700 text-white', icon: 'clock', title: 'Fora do horário' },
  falha_conexao: { cls: 'bg-slate-700 text-white', icon: 'wifiOff', title: 'Falha de conexão' },
};

function ResultCard({ r }: { r: Result }) {
  const s = style[r.result];
  return (
    <div role="status" aria-live="assertive" data-result={r.result} className={`rounded-xl p-5 shadow-lg ${s.cls}`}>
      <div className="flex items-center gap-3">
        <Icon name={s.icon} className="h-10 w-10 shrink-0" />
        <div>
          <p className="text-xl font-bold">{s.title}</p>
          <p className="text-sm opacity-90">{r.message}</p>
        </div>
      </div>
      {r.participant && (
        <div className="mt-4 rounded-lg bg-black/10 p-3">
          <p className="text-lg font-semibold">{r.participant.name}</p>
          <p className="text-sm">{r.participant.school}</p>
          <p className="font-mono text-xs opacity-80">{r.participant.protocol}</p>
        </div>
      )}
      {r.checkedInAt && <p className="mt-2 text-sm">{r.result === 'ja_registrado' ? 'Registrado' : 'Horário'}: {fmtTime(r.checkedInAt)}{r.checkedInBy ? ` por ${r.checkedInBy}` : ''}</p>}
      {r.otherEvent && <p className="mt-2 text-sm">Evento do código: {r.otherEvent}</p>}
    </div>
  );
}

type CamState = 'idle' | 'starting' | 'on' | 'denied' | 'unavailable' | 'insecure';

export function CheckinScanner() {
  useTitle('Leitura de QR Code');
  const { eventId, sessionId } = useParams();
  const [ev, setEv] = useState<CheckinEvent | null>(null);
  const [cam, setCam] = useState<CamState>('idle');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<{ present: number; confirmed: number } | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: string; protocol: string; status: string; name: string; school: string; present: boolean }[] | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const busyRef = useRef(false);

  const loadStats = useCallback(() => api(`/api/admin/checkin/stats?eventId=${eventId}&sessionId=${sessionId}`).then(setStats).catch(() => undefined), [eventId, sessionId]);
  useEffect(() => {
    api<CheckinEvent[]>('/api/admin/checkin/events').then((l) => setEv(l.find((e) => e.id === eventId) ?? null));
    void loadStats();
  }, [eventId, loadStats]);

  const send = useCallback(
    async (body: { raw?: string; registrationId?: string }) => {
      busyRef.current = true;
      setBusy(true);
      try {
        const r = await api<Result>('/api/admin/checkin', { body: { eventId, sessionId, ...body } });
        setResult(r);
        if (navigator.vibrate) navigator.vibrate(r.result === 'registrado' ? 120 : [80, 60, 80]);
        if (r.result === 'registrado') void loadStats();
      } catch (e) {
        const a = e as ApiError;
        setResult(a.status === 0 ? { result: 'falha_conexao', message: 'Sem conexão com o servidor. A presença NÃO foi registrada; tente novamente.' } : { result: 'falha_conexao', message: a.message });
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [eventId, sessionId, loadStats],
  );

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCam('idle');
  }, []);

  useEffect(() => stop, [stop]);

  const start = async () => {
    if (!window.isSecureContext) return setCam('insecure');
    if (!navigator.mediaDevices?.getUserMedia) return setCam('unavailable');
    setCam('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      setCam('on');
      scan();
    } catch (e) {
      const n = (e as DOMException).name;
      setCam(n === 'NotAllowedError' || n === 'SecurityError' ? 'denied' : 'unavailable');
    }
  };

  const scan = () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || !streamRef.current) return;
    if (v.readyState >= 2 && !busyRef.current) {
      const scale = Math.min(1, 720 / Math.max(v.videoWidth, 1));
      c.width = Math.floor(v.videoWidth * scale);
      c.height = Math.floor(v.videoHeight * scale);
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(v, 0, 0, c.width, c.height);
      const img = ctx.getImageData(0, 0, c.width, c.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
      const now = Date.now();
      // Ignora a mesma leitura repetida em sequência (o servidor também impede duplicidade)
      if (code?.data && !(code.data === lastRef.current.text && now - lastRef.current.at < 4000)) {
        lastRef.current = { text: code.data, at: now };
        void send({ raw: code.data });
      }
    }
    requestAnimationFrame(scan);
  };

  const search = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setFound(await api(`/api/admin/checkin/search?eventId=${eventId}&sessionId=${sessionId}&q=${encodeURIComponent(q)}`));
    } catch (err) {
      setResult({ result: 'falha_conexao', message: (err as ApiError).message });
    }
  };

  const session = ev?.sessions.find((s) => s.id === sessionId);
  return (
    <div className="mx-auto max-w-xl">
      <Link to="/admin/credenciamento" className="text-sm text-slate-600 underline">← Trocar evento</Link>
      <h1 className="mt-2 text-xl font-bold">{ev?.title ?? 'Credenciamento'}</h1>
      {session && <p className="text-sm text-slate-600">{session.title || 'Sessão'} · {fmtDate(session.startsAt)} {fmtTime(session.startsAt)}–{fmtTime(session.endsAt)}</p>}
      {stats && <p className="mt-2 text-sm"><Badge color="green">{stats.present} presentes</Badge> <span className="text-slate-600">de {stats.confirmed} inscrições confirmadas</span></p>}

      <div className="relative mt-4 overflow-hidden rounded-xl bg-slate-900">
        <video ref={videoRef} playsInline muted className={`aspect-[4/3] w-full object-cover ${cam === 'on' ? '' : 'hidden'}`} />
        {cam === 'on' && <div aria-hidden className="pointer-events-none absolute inset-[15%] rounded-2xl border-4 border-white/80" />}
        {cam !== 'on' && (
          <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 p-6 text-center text-white">
            <Icon name="camera" className="h-12 w-12 opacity-80" />
            {cam === 'idle' && <p className="text-sm opacity-90">Toque em “Iniciar câmera” e autorize o acesso quando o navegador pedir.</p>}
            {cam === 'starting' && <p className="text-sm">Abrindo a câmera…</p>}
            {cam === 'denied' && <p className="text-sm" data-cam="denied">Permissão da câmera negada. Libere o acesso nas configurações do navegador para este site ou use a busca manual abaixo.</p>}
            {cam === 'unavailable' && <p className="text-sm" data-cam="unavailable">Câmera indisponível neste dispositivo. Use a busca manual abaixo.</p>}
            {cam === 'insecure' && <p className="text-sm" data-cam="insecure">A câmera só funciona em conexão segura (HTTPS). Peça ao responsável técnico para acessar pelo endereço com https.</p>}
          </div>
        )}
        <canvas ref={canvasRef} className="hidden" />
        {busy && <div className="absolute inset-x-0 bottom-0 bg-black/60 p-2 text-center text-sm text-white">Validando no servidor…</div>}
      </div>
      <div className="mt-3 flex gap-2">
        {cam === 'on' ? <button className="btn-secondary flex-1" onClick={stop}>Parar câmera</button> : <button className="btn-primary flex-1" onClick={start} disabled={cam === 'starting'}><Icon name="camera" />Iniciar câmera</button>}
      </div>

      <div className="mt-4 min-h-[120px]">{result && <ResultCard r={result} />}</div>

      <section className="card mt-6 p-4" aria-labelledby="manual">
        <h2 id="manual" className="font-semibold">Busca manual</h2>
        <p className="text-sm text-slate-600">Para quem está sem o QR Code: busque por nome ou protocolo.</p>
        <form onSubmit={search} className="mt-3 flex items-end gap-2">
          <div className="flex-1"><TextInput label="Nome ou protocolo" value={q} onChange={(e) => setQ(e.target.value)} minLength={3} /></div>
          <button className="btn-secondary"><Icon name="search" />Buscar</button>
        </form>
        {found && (found.length === 0 ? <p className="mt-3 text-sm text-slate-600">Nenhuma inscrição encontrada neste evento.</p> : (
          <ul className="mt-3 divide-y divide-slate-100">
            {found.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0"><span className="block font-medium">{f.name}</span><span className="block text-xs text-slate-500">{f.school} · {f.protocol}</span></span>
                {f.status !== 'confirmada' ? <Badge color="red">Cancelada</Badge> : f.present ? <Badge color="green">Presente</Badge> : (
                  <button className="btn-primary" onClick={async () => { await send({ registrationId: f.id }); setFound(found.map((x) => (x.id === f.id ? { ...x, present: true } : x))); }}>Registrar</button>
                )}
              </li>
            ))}
          </ul>
        ))}
      </section>
    </div>
  );
}
