// What the operator console shows, computed from verification documents.
//
// Pure, so the masking rule is testable: a non-operator sees every outcome, score and
// tactic, but only their OWN identity and question. Somebody else's name, email and what
// they were asked are an operator's business, not another visitor's.

const LIVE_WINDOW_MS = 3 * 60_000;

const toDate = (v) => (v?.toDate ? v.toDate() : v instanceof Date ? v : v ? new Date(v) : null);

function outcomeOf(doc) {
  if (doc.verdict?.outcome) return doc.verdict.outcome;
  return doc.status === 'live' ? 'in-progress' : 'abandoned';
}

function maskEmail(email) {
  if (!email) return null;
  const [name, domain] = String(email).split('@');
  return `${name.slice(0, 1)}•••@${domain ?? ''}`;
}

export function summarise(docs, { viewerUid, operator, hours, now = Date.now() }) {
  const counts = { total: 0, passed: 0, blocked: 0, failed: 0, inProgress: 0, abandoned: 0 };
  const bucketMs = hours <= 24 ? 3600_000 : 6 * 3600_000;
  const buckets = new Map();
  const live = [];
  const records = [];
  const vectorCounts = {};

  for (const doc of docs) {
    const created = toDate(doc.createdAt);
    const updated = toDate(doc.updatedAt) ?? created;
    const outcome = outcomeOf(doc);
    const own = doc.uid === viewerUid;
    const visible = operator || own;
    const peak = doc.peak ?? null;

    counts.total++;
    if (outcome === 'passed') counts.passed++;
    else if (outcome === 'blocked-coaching') counts.blocked++;
    else if (outcome === 'failed') counts.failed++;
    else if (outcome === 'in-progress') counts.inProgress++;
    else counts.abandoned++;

    for (const v of peak?.vectors ?? []) vectorCounts[v] = (vectorCounts[v] ?? 0) + 1;

    if (created) {
      const key = Math.floor(created.getTime() / bucketMs) * bucketMs;
      const b = buckets.get(key) ?? { t: new Date(key).toISOString(), passed: 0, blocked: 0, other: 0 };
      if (outcome === 'passed') b.passed++;
      else if (outcome === 'blocked-coaching') b.blocked++;
      else b.other++;
      buckets.set(key, b);
    }

    const who = visible
      ? doc.user?.name || doc.user?.email || 'Google user'
      : maskEmail(doc.user?.email) ?? 'Google user';

    const row = {
      id: doc.id,
      own,
      createdAt: created?.toISOString() ?? null,
      app: doc.app ?? 'console',
      mode: doc.mode ?? null,
      outcome,
      reason: doc.verdict?.reason ?? null,
      peakRisk: peak?.riskScore ?? null,
      peakConfidence: peak?.confidence ?? null,
      vectors: peak?.vectors ?? [],
      assessments: doc.assessments ?? 0,
      who,
      question: visible ? doc.question ?? null : null,
      detail: visible,
    };
    records.push(row);
    if (outcome === 'in-progress' && updated && now - updated.getTime() < LIVE_WINDOW_MS) live.push(row);
  }

  return {
    hours,
    counts,
    trend: [...buckets.values()].sort((a, b) => a.t.localeCompare(b.t)),
    vectors: Object.entries(vectorCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    live,
    records,
  };
}
