import { statusMeta } from '../utils/helpers';
const extraMeta = {
    consumed: { tag: 'approved', label: 'Dispensed' },
    pending: { tag: 'pending', label: 'Pending' },
    approved: { tag: 'approved', label: 'Approved' },
    rejected: { tag: 'rejected', label: 'Rejected' },
};
export default function SlotTag({ status }) {
    const meta = statusMeta[status] ?? extraMeta[status];
    return (<span className={`tag ${meta.tag}`}>
      <span className="dot"/>
      {meta.label}
    </span>);
}
