import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { useApp, useTitle } from '../../lib/app';
import { Alert, TextInput } from '../../components/ui';
import { Logo } from '../../components/Logo';

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  const { settings } = useApp();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center text-primary">
          <Logo className="h-14" />
          <p className="text-sm text-slate-600">{settings?.department}</p>
          <p className="font-semibold text-slate-900">{settings?.platformName}</p>
        </div>
        <div className="card p-6">
          <h1 className="text-xl font-bold">{title}</h1>
          {children}
        </div>
        <p className="mt-4 text-center text-sm"><Link to="/" className="underline">Voltar ao site público</Link></p>
      </div>
    </div>
  );
}

export function Login() {
  useTitle('Entrar');
  const { setSession } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setSession(await api('/api/auth/login', { body: { email, password } }));
      nav((loc.state as { from?: string } | null)?.from ?? '/admin', { replace: true });
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Área restrita">
      <form onSubmit={submit} className="mt-4 grid gap-4">
        {error && <Alert tone="error">{error}</Alert>}
        <TextInput label="E-mail" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <TextInput label="Senha" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button className="btn-primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        <Link to="/admin/esqueci-senha" className="text-center text-sm underline">Esqueci minha senha</Link>
      </form>
    </Shell>
  );
}

export function Forgot() {
  useTitle('Recuperar acesso');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setMsg((await api('/api/auth/forgot', { body: { email } })).message);
    } catch (err) {
      setError((err as ApiError).message);
    }
  };
  return (
    <Shell title="Recuperar acesso">
      <form onSubmit={submit} className="mt-4 grid gap-4">
        <p className="text-sm text-slate-600">Informe seu e-mail de acesso. Se estiver cadastrado, enviaremos um link válido por 1 hora.</p>
        {msg && <Alert tone="info">{msg}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        <TextInput label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <button className="btn-primary">Enviar link</button>
        <Link to="/admin/entrar" className="text-center text-sm underline">Voltar</Link>
      </form>
    </Shell>
  );
}

export function ResetPassword() {
  useTitle('Nova senha');
  const { token } = useParams();
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) return setError('As senhas não conferem.');
    try {
      await api('/api/auth/reset', { body: { token, password: pw } });
      setDone(true);
      setTimeout(() => nav('/admin/entrar'), 2000);
    } catch (err) {
      const a = err as ApiError;
      setError(a.fields.password ?? a.message);
    }
  };
  return (
    <Shell title="Definir nova senha">
      <form onSubmit={submit} className="mt-4 grid gap-4">
        {done && <Alert tone="success">Senha alterada. Redirecionando para o login…</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        <TextInput label="Nova senha" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} hint="Mínimo de 12 caracteres, com letras e números." required />
        <TextInput label="Repita a nova senha" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
        <button className="btn-primary" disabled={done}>Salvar</button>
      </form>
    </Shell>
  );
}

export function ChangePassword() {
  useTitle('Alterar senha');
  const { setSession } = useApp();
  const nav = useNavigate();
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/api/auth/change-password', { body: { current, password: pw } });
      setSession({ user: null });
      nav('/admin/entrar');
    } catch (err) {
      const a = err as ApiError;
      setError(a.fields.password ?? a.message);
    }
  };
  return (
    <div className="max-w-md">
      <h1 className="text-2xl font-bold">Alterar senha</h1>
      <form onSubmit={submit} className="card mt-4 grid gap-4 p-5">
        {error && <Alert tone="error">{error}</Alert>}
        <TextInput label="Senha atual" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        <TextInput label="Nova senha" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} hint="Mínimo de 12 caracteres, com letras e números. Todas as sessões serão encerradas." required />
        <button className="btn-primary">Alterar senha</button>
      </form>
    </div>
  );
}
