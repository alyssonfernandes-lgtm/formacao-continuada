import { useState } from 'react';
import { Alert, Modal, TextArea } from './ui';

/** Diálogo que exige justificativa antes de uma ação sensível (registrada na auditoria). */
export function ReasonDialog({ title, description, confirmLabel, danger, onConfirm, onClose }: {
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (reason.trim().length < 5) return setError('Informe a justificativa (mínimo de 5 caracteres).');
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title={title} onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Cancelar</button><button className={danger ? 'btn-danger' : 'btn-primary'} onClick={go} disabled={busy}>{confirmLabel}</button></>}>
      {description && <p className="mb-3 text-slate-700">{description}</p>}
      <TextArea label="Justificativa" required value={reason} onChange={(e) => setReason(e.target.value)} error={error} />
      <div className="mt-3"><Alert tone="info">Esta ação fica registrada na auditoria com seu usuário e horário.</Alert></div>
    </Modal>
  );
}
