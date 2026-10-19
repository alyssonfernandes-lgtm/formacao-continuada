-- Esquema inicial da plataforma de formação continuada
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('admin', 'coordenacao', 'credenciamento', 'consulta');
CREATE TYPE event_status AS ENUM ('rascunho', 'publicado', 'concluido', 'cancelado');
CREATE TYPE cert_criterion AS ENUM ('todas_sessoes', 'percentual_minimo');
CREATE TYPE registration_status AS ENUM ('confirmada', 'cancelada');
CREATE TYPE attendance_method AS ENUM ('qrcode', 'manual', 'correcao');
CREATE TYPE certificate_status AS ENUM ('valido', 'substituido', 'revogado');
CREATE TYPE email_kind AS ENUM ('confirmacao', 'certificado', 'redefinir_senha');
CREATE TYPE email_status AS ENUM ('pendente', 'enviando', 'enviado', 'falhou');

CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);

CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  email               citext NOT NULL UNIQUE,
  password_hash       text NOT NULL,
  role                user_role NOT NULL,
  active              boolean NOT NULL DEFAULT true,
  failed_logins       integer NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  last_login_at       timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_sessions (
  id            bytea PRIMARY KEY,               -- SHA-256 do token do cookie
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  ip            inet,
  user_agent    text
);
CREATE INDEX user_sessions_user_idx ON user_sessions(user_id);
CREATE INDEX user_sessions_expires_idx ON user_sessions(expires_at);

CREATE TABLE password_resets (
  token_hash  bytea PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE schools (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        citext NOT NULL UNIQUE CHECK (length(name) BETWEEN 2 AND 200),
  unit        text,                             -- unidade administrativa/regional, quando aplicável
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                    text NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
  description              text NOT NULL DEFAULT '',
  objectives               text NOT NULL DEFAULT '',
  target_audience          text NOT NULL DEFAULT '',
  syllabus                 text NOT NULL DEFAULT '',
  location                 text NOT NULL DEFAULT '',
  modality                 text NOT NULL DEFAULT 'Presencial',
  instructor               text NOT NULL DEFAULT '',
  promoter                 text NOT NULL DEFAULT '',
  workload_hours           numeric(6,2) NOT NULL CHECK (workload_hours > 0),
  capacity                 integer CHECK (capacity IS NULL OR capacity > 0),
  registration_opens_at    timestamptz NOT NULL,
  registration_closes_at   timestamptz NOT NULL,
  status                   event_status NOT NULL DEFAULT 'rascunho',
  certificate_info         text NOT NULL DEFAULT '',
  cert_criterion           cert_criterion NOT NULL DEFAULT 'todas_sessoes',
  cert_min_percent         integer NOT NULL DEFAULT 75 CHECK (cert_min_percent BETWEEN 1 AND 100),
  -- integral: certifica a carga horária do evento; proporcional: certifica as horas das sessões presentes
  cert_hours_mode          text NOT NULL DEFAULT 'integral' CHECK (cert_hours_mode IN ('integral', 'proporcional')),
  cert_signer_name         text NOT NULL DEFAULT '',
  cert_signer_role         text NOT NULL DEFAULT '',
  certificates_released_at timestamptz,
  certificates_released_by uuid REFERENCES users(id),
  created_by               uuid REFERENCES users(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (registration_closes_at > registration_opens_at)
);
CREATE INDEX events_status_idx ON events(status);

CREATE TABLE event_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT '',
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  hours       numeric(6,2) NOT NULL CHECK (hours > 0),
  CHECK (ends_at > starts_at)
);
CREATE INDEX event_sessions_event_idx ON event_sessions(event_id, starts_at);

CREATE TABLE event_staff (
  event_id  uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE participants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   text NOT NULL CHECK (length(full_name) BETWEEN 3 AND 200),
  cpf_hash    bytea NOT NULL UNIQUE,            -- HMAC-SHA256(CPF) — índice cego
  cpf_enc     bytea NOT NULL,                   -- AES-256-GCM(CPF)
  cpf_masked  text NOT NULL,                    -- ***.456.789-**
  email       citext NOT NULL,
  phone       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE registrations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol       text NOT NULL UNIQUE,
  event_id       uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  school_id      uuid REFERENCES schools(id),
  school_other   text,
  status         registration_status NOT NULL DEFAULT 'confirmada',
  qr_token_hash  bytea NOT NULL UNIQUE,
  qr_token_enc   bytea NOT NULL,
  qr_token_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  cancelled_at   timestamptz,
  cancelled_by   uuid REFERENCES users(id),
  cancel_reason  text,
  CHECK (school_id IS NOT NULL OR (school_other IS NOT NULL AND length(school_other) >= 2))
);
-- Uma inscrição ativa por pessoa e evento; inscrições em eventos diferentes continuam permitidas
CREATE UNIQUE INDEX registrations_unique_active ON registrations(event_id, participant_id) WHERE status = 'confirmada';
CREATE INDEX registrations_event_idx ON registrations(event_id, status);
CREATE INDEX registrations_participant_idx ON registrations(participant_id);

CREATE TABLE attendances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES registrations(id) ON DELETE RESTRICT,
  session_id      uuid NOT NULL REFERENCES event_sessions(id) ON DELETE RESTRICT,
  checked_in_at   timestamptz NOT NULL DEFAULT now(),   -- horário oficial do servidor
  checked_in_by   uuid NOT NULL REFERENCES users(id),
  method          attendance_method NOT NULL,
  justification   text,
  revoked_at      timestamptz,
  revoked_by      uuid REFERENCES users(id),
  revoke_reason   text,
  CHECK (method <> 'correcao' OR length(coalesce(justification, '')) >= 5),
  CHECK (revoked_at IS NULL OR (revoke_reason IS NOT NULL AND length(revoke_reason) >= 5))
);
-- Um check-in válido por inscrição e por sessão
CREATE UNIQUE INDEX attendances_unique_valid ON attendances(registration_id, session_id) WHERE revoked_at IS NULL;
CREATE INDEX attendances_session_idx ON attendances(session_id);

CREATE TABLE certificates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number            text NOT NULL UNIQUE,
  verification_code text NOT NULL UNIQUE,
  registration_id   uuid NOT NULL REFERENCES registrations(id) ON DELETE RESTRICT,
  status            certificate_status NOT NULL DEFAULT 'valido',
  hours             numeric(6,2) NOT NULL CHECK (hours > 0),
  snapshot          jsonb NOT NULL,          -- dados impressos no documento, imutáveis
  issued_at         timestamptz NOT NULL DEFAULT now(),
  issued_by         uuid REFERENCES users(id),
  replaces_id       uuid REFERENCES certificates(id),
  invalidated_at    timestamptz,
  invalidated_by    uuid REFERENCES users(id),
  invalidated_reason text
);
-- Um certificado válido por inscrição
CREATE UNIQUE INDEX certificates_unique_valid ON certificates(registration_id) WHERE status = 'valido';
CREATE SEQUENCE certificate_number_seq;

CREATE TABLE email_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             email_kind NOT NULL,
  to_address       citext NOT NULL,
  registration_id  uuid REFERENCES registrations(id) ON DELETE CASCADE,
  certificate_id   uuid REFERENCES certificates(id) ON DELETE CASCADE,
  user_id          uuid REFERENCES users(id) ON DELETE CASCADE,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- sem dados pessoais além do necessário
  status           email_status NOT NULL DEFAULT 'pendente',
  attempts         integer NOT NULL DEFAULT 0,
  max_attempts     integer NOT NULL DEFAULT 6,
  last_error       text,
  provider_message_id text,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  locked_at        timestamptz,
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES users(id)
);
CREATE INDEX email_messages_queue_idx ON email_messages(next_attempt_at) WHERE status IN ('pendente', 'enviando');
CREATE INDEX email_messages_registration_idx ON email_messages(registration_id);
CREATE INDEX email_messages_certificate_idx ON email_messages(certificate_id);
-- Nunca dois envios em andamento do mesmo certificado
CREATE UNIQUE INDEX email_messages_cert_inflight ON email_messages(certificate_id) WHERE kind = 'certificado' AND status IN ('pendente', 'enviando');
CREATE UNIQUE INDEX email_messages_conf_inflight ON email_messages(registration_id) WHERE kind = 'confirmacao' AND status IN ('pendente', 'enviando');

CREATE TABLE audit_logs (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  action       text NOT NULL,
  entity_type  text,
  entity_id    text,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip           inet
);
CREATE INDEX audit_logs_at_idx ON audit_logs(at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type, entity_id);

-- Frequência de cada inscrição: definição única usada por certificados e relatórios
CREATE VIEW registration_progress AS
WITH totals AS (
  SELECT e.id AS event_id,
         count(es.id)::int AS total_sessions,
         coalesce(sum(es.hours), 0)::numeric AS total_session_hours,
         min(es.starts_at) AS first_start,
         max(es.ends_at) AS last_end
    FROM events e LEFT JOIN event_sessions es ON es.event_id = e.id
   GROUP BY e.id
), att AS (
  SELECT a.registration_id,
         count(*)::int AS attended_sessions,
         sum(es.hours)::numeric AS attended_hours
    FROM attendances a JOIN event_sessions es ON es.id = a.session_id
   WHERE a.revoked_at IS NULL
   GROUP BY a.registration_id
)
SELECT r.id AS registration_id,
       r.event_id,
       r.participant_id,
       r.status,
       t.total_sessions,
       t.total_session_hours,
       t.first_start,
       t.last_end,
       coalesce(att.attended_sessions, 0) AS attended_sessions,
       coalesce(att.attended_hours, 0) AS attended_hours,
       CASE WHEN t.total_session_hours > 0
            THEN round(100 * coalesce(att.attended_hours, 0) / t.total_session_hours, 2) ELSE 0 END AS attendance_percent,
       (r.status = 'confirmada' AND t.total_sessions > 0 AND
         CASE e.cert_criterion
           WHEN 'todas_sessoes' THEN coalesce(att.attended_sessions, 0) = t.total_sessions
           ELSE 100 * coalesce(att.attended_hours, 0) >= e.cert_min_percent * t.total_session_hours
         END) AS meets_criterion,
       CASE WHEN e.cert_criterion = 'percentual_minimo' AND e.cert_hours_mode = 'proporcional' AND t.total_session_hours > 0
            THEN round(e.workload_hours * coalesce(att.attended_hours, 0) / t.total_session_hours, 2)
            ELSE e.workload_hours END AS certifiable_hours
  FROM registrations r
  JOIN events e ON e.id = r.event_id
  JOIN totals t ON t.event_id = r.event_id
  LEFT JOIN att ON att.registration_id = r.id;
