import { STATUSES, STATUS_LABELS } from '@/lib/config';

export default function StatusSteps({ status }) {
  if (status === '취소') return <div className="pill pill-cancel">주문 취소됨</div>;
  const cur = STATUSES.indexOf(status);
  return (
    <ol className="steps" aria-label={`현재 상태: ${STATUS_LABELS[status] || status}`}>
      {STATUSES.map((s, i) => (
        <li key={s} className={i < cur ? 'done' : i === cur ? 'current' : ''}>
          <span className="dot" aria-hidden="true">{i < cur ? '✓' : i + 1}</span>
          <span>{STATUS_LABELS[s]}</span>
        </li>
      ))}
    </ol>
  );
}

export function StatusPill({ status }) {
  const cls = { 접수: 'wait', 발송중: 'ship', 발송완료: 'done', 취소: 'cancel' }[status];
  return <span className={`pill pill-${cls}`}>{STATUS_LABELS[status] || status}</span>;
}
