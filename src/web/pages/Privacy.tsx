import { useApp, useTitle } from '../lib/app';

export function Privacy() {
  useTitle('Aviso de privacidade');
  const { settings: s } = useApp();
  if (!s) return null;
  const controller = s.controllerName || `${s.municipality ? `Prefeitura de ${s.municipality}, por meio da ` : ''}${s.department}`;
  return (
    <article className="prose mx-auto max-w-3xl text-slate-800 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:mt-2">
      <h1 className="text-2xl font-bold">Aviso de privacidade</h1>
      <p className="mt-2 text-sm text-slate-600">Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018)</p>
      <h2>Quem trata os seus dados</h2>
      <p>Controlador: <strong>{controller}</strong>.</p>
      <p>Encarregado pelo tratamento de dados pessoais: {s.dpoName || <em>a ser indicado pela administração municipal</em>}{s.dpoContact ? ` — ${s.dpoContact}` : ''}.</p>
      <h2>Quais dados e para quê</h2>
      <ul>
        <li><strong>Nome completo</strong>: identificar você na inscrição, no credenciamento e no certificado.</li>
        <li><strong>CPF</strong>: evitar inscrições duplicadas e identificar o profissional no registro de formação. É armazenado cifrado e exibido mascarado; não aparece em páginas públicas, links ou QR Codes.</li>
        <li><strong>Escola ou instituição</strong>: organizar o credenciamento e produzir relatórios de participação por unidade.</li>
        <li><strong>E-mail</strong>: enviar a confirmação da inscrição e o certificado.</li>
        <li><strong>Telefone</strong>: contato em caso de alteração ou cancelamento do evento.</li>
      </ul>
      <h2>Base legal</h2>
      <p>O tratamento é realizado pela administração pública para a execução de políticas públicas de formação continuada dos profissionais da educação e para o cumprimento de obrigações legais de registro e prestação de contas (art. 7º, incisos II e III, e art. 23 da LGPD). A ciência deste aviso no formulário não substitui essas bases legais.</p>
      <h2>Compartilhamento</h2>
      <p>Os dados não são vendidos nem publicados. Podem ser tratados por operadores contratados para hospedagem da plataforma e envio de e-mails, sob obrigações de segurança, e informados a órgãos de controle quando exigido por lei. A página de verificação de certificados mostra apenas nome, evento, período e carga horária a quem possuir o código impresso no documento.</p>
      <h2>Por quanto tempo</h2>
      <p>Registros de inscrição, presença e certificados são mantidos enquanto necessários ao histórico de formação e às obrigações de guarda da administração. Inscrições canceladas sem presença são eliminadas após {s.retentionCancelledDays} dias.</p>
      <h2>Seus direitos</h2>
      <p>Você pode solicitar confirmação, acesso, correção de dados incompletos ou desatualizados, informações sobre compartilhamento e demais direitos previstos no art. 18 da LGPD, nos limites aplicáveis ao poder público.</p>
      <p>Canal de contato: {[s.contactEmail, s.contactPhone].filter(Boolean).join(' · ') || s.department}{s.dpoContact ? ` · Encarregado: ${s.dpoContact}` : ''}.</p>
      {s.privacyExtra && (
        <>
          <h2>Informações adicionais</h2>
          <p className="whitespace-pre-line">{s.privacyExtra}</p>
        </>
      )}
    </article>
  );
}
