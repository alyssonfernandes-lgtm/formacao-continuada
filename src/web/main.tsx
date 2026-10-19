import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './styles.css';
import { AppProvider } from './lib/app';
import { PublicLayout } from './components/PublicLayout';
import { AdminLayout, RequirePerm } from './components/AdminLayout';
import { EventsList } from './pages/EventsList';
import { EventDetail } from './pages/EventDetail';
import { MyRegistration } from './pages/MyRegistration';
import { Verify } from './pages/Verify';
import { Privacy } from './pages/Privacy';
import { ChangePassword, Forgot, Login, ResetPassword } from './pages/admin/Auth';
import { EventForm, EventsAdmin } from './pages/admin/Events';
import { EventManage } from './pages/admin/EventManage';
import { CheckinScanner, CheckinSelect } from './pages/admin/Checkin';
import { Dashboard, Reports } from './pages/admin/Reports';
import { Audit, Emails, Schools, SettingsPage, Users } from './pages/admin/Misc';

function NotFound() {
  return <div className="card p-6"><h1 className="text-lg font-semibold">Página não encontrada</h1><a className="mt-2 inline-block underline" href="/">Ir para o início</a></div>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<EventsList />} />
            <Route path="eventos/:id" element={<EventDetail />} />
            <Route path="i/:token" element={<MyRegistration />} />
            <Route path="verificar" element={<Verify />} />
            <Route path="verificar/:code" element={<Verify />} />
            <Route path="privacidade" element={<Privacy />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="admin/entrar" element={<Login />} />
          <Route path="admin/esqueci-senha" element={<Forgot />} />
          <Route path="admin/redefinir-senha/:token" element={<ResetPassword />} />
          <Route path="admin" element={<AdminLayout />}>
            <Route index element={<RequirePerm perm={['reports.summary']}><Dashboard /></RequirePerm>} />
            <Route path="eventos" element={<RequirePerm perm={['events.manage']}><EventsAdmin /></RequirePerm>} />
            <Route path="eventos/novo" element={<RequirePerm perm={['events.manage']}><EventForm /></RequirePerm>} />
            <Route path="eventos/:id" element={<RequirePerm perm={['events.manage', 'registrations.view']}><EventManage /></RequirePerm>} />
            <Route path="eventos/:id/editar" element={<RequirePerm perm={['events.manage']}><EventForm /></RequirePerm>} />
            <Route path="credenciamento" element={<RequirePerm perm={['checkin.any', 'checkin.assigned']}><CheckinSelect /></RequirePerm>} />
            <Route path="credenciamento/:eventId/:sessionId" element={<RequirePerm perm={['checkin.any', 'checkin.assigned']}><CheckinScanner /></RequirePerm>} />
            <Route path="relatorios" element={<RequirePerm perm={['reports.summary']}><Reports /></RequirePerm>} />
            <Route path="emails" element={<RequirePerm perm={['emails.view']}><Emails /></RequirePerm>} />
            <Route path="escolas" element={<RequirePerm perm={['events.manage']}><Schools /></RequirePerm>} />
            <Route path="usuarios" element={<RequirePerm perm={['users.manage']}><Users /></RequirePerm>} />
            <Route path="configuracoes" element={<RequirePerm perm={['settings.manage']}><SettingsPage /></RequirePerm>} />
            <Route path="auditoria" element={<RequirePerm perm={['audit.view']}><Audit /></RequirePerm>} />
            <Route path="senha" element={<ChangePassword />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  </StrictMode>,
);

// PWA: o service worker guarda apenas a interface; nunca respostas da API (dados pessoais)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
