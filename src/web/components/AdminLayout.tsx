import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useApp } from '../lib/app';
import { ROLE_LABELS, type Permission } from '../../shared/types';
import { Icon, type IconName } from './Icon';
import { Logo } from './Logo';
import { Spinner } from './ui';

const items: { to: string; label: string; icon: IconName; perm: Permission[] }[] = [
  { to: '/admin', label: 'Painel', icon: 'chart', perm: ['reports.summary'] },
  { to: '/admin/eventos', label: 'Eventos', icon: 'list', perm: ['events.manage'] },
  { to: '/admin/credenciamento', label: 'Credenciamento', icon: 'qr', perm: ['checkin.any', 'checkin.assigned'] },
  { to: '/admin/relatorios', label: 'Relatórios', icon: 'download', perm: ['reports.summary'] },
  { to: '/admin/emails', label: 'Fila de e-mails', icon: 'mail', perm: ['emails.view'] },
  { to: '/admin/escolas', label: 'Escolas', icon: 'school', perm: ['events.manage'] },
  { to: '/admin/usuarios', label: 'Usuários', icon: 'users', perm: ['users.manage'] },
  { to: '/admin/configuracoes', label: 'Configurações', icon: 'settings', perm: ['settings.manage'] },
  { to: '/admin/auditoria', label: 'Auditoria', icon: 'shield', perm: ['audit.view'] },
];

export function AdminLayout() {
  const { me, authLoaded, refreshMe, can, setSession, settings } = useApp();
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => {
    if (!authLoaded) void refreshMe();
  }, [authLoaded, refreshMe]);
  useEffect(() => setMenu(false), [loc.pathname]);
  if (!authLoaded) return <div className="p-6"><Spinner /></div>;
  if (!me) return <Navigate to="/admin/entrar" replace state={{ from: loc.pathname }} />;
  const visible = items.filter((i) => i.perm.some((p) => can(p)));
  // Perfis sem painel (credenciamento) caem direto na sua função
  if (loc.pathname === '/admin' && !can('reports.summary') && visible[0]) return <Navigate to={visible[0].to} replace />;

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setSession({ user: null });
    nav('/admin/entrar');
  };
  const linkCls = ({ isActive }: { isActive: boolean }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${isActive ? 'bg-primary text-primary-fg' : 'text-slate-700 hover:bg-slate-100'}`;
  const sidebar = (
    <nav aria-label="Área restrita" className="flex flex-col gap-1">
      {visible.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.to === '/admin'} className={linkCls}>
          <Icon name={i.icon} />
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_1fr]">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">Ir para o conteúdo</a>
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <Link to="/admin" className="flex min-w-0 items-center gap-2 text-primary"><Logo className="h-8" /><span className="truncate font-semibold text-slate-900">{settings?.platformName}</span></Link>
        <button className="btn-ghost px-2" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-controls="menu-movel"><Icon name={menu ? 'x' : 'menu'} label={menu ? 'Fechar menu' : 'Abrir menu'} /></button>
      </header>
      {menu && <div id="menu-movel" className="border-b border-slate-200 bg-white p-3 lg:hidden">{sidebar}<button onClick={logout} className="btn-ghost mt-2 w-full justify-start"><Icon name="logout" />Sair</button></div>}
      <aside className="hidden border-r border-slate-200 bg-white lg:flex lg:flex-col">
        <Link to="/admin" className="flex items-center gap-3 border-b border-slate-200 p-4 text-primary">
          <Logo className="h-10" />
          <span className="min-w-0 text-sm font-semibold leading-tight text-slate-900">{settings?.platformName}</span>
        </Link>
        <div className="flex-1 p-3">{sidebar}</div>
        <div className="border-t border-slate-200 p-4 text-sm">
          <p className="font-medium">{me.name}</p>
          <p className="text-xs text-slate-600">{ROLE_LABELS[me.role]}</p>
          <div className="mt-2 flex gap-2">
            <Link to="/admin/senha" className="text-xs underline">Alterar senha</Link>
            <button onClick={logout} className="text-xs underline">Sair</button>
          </div>
        </div>
      </aside>
      <main id="conteudo" className="min-w-0 px-4 py-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}

export function RequirePerm({ perm, children }: { perm: Permission[]; children: React.ReactNode }) {
  const { can } = useApp();
  if (!perm.some((p) => can(p))) return <div className="card p-6"><h1 className="text-lg font-semibold">Acesso não autorizado</h1><p className="mt-1 text-sm text-slate-600">Seu perfil não permite acessar esta página.</p></div>;
  return <>{children}</>;
}
