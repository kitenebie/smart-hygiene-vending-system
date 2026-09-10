import { statusMeta } from '../utils/helpers';

type Status = 'ok' | 'low' | 'empty' | 'pending' | 'approved' | 'rejected' | 'consumed';

const extraMeta: Record<string, { tag: string; label: string }> = {
  consumed: { tag: 'approved', label: 'Dispensed' },
  pending:  { tag: 'pending',  label: 'Pending' },
  approved: { tag: 'approved', label: 'Approved' },
  rejected: { tag: 'rejected', label: 'Rejected' },
};

interface SlotTagProps {
  status: Status;
}

export default function SlotTag({ status }: SlotTagProps) {
  const meta = statusMeta[status as keyof typeof statusMeta] ?? extraMeta[status];
  return (
    <span className={`tag ${meta.tag}`}>
      <span className="dot" />
      {meta.label}
    </span>
  );
}
