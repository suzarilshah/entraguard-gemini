// EntraGuard security console on Google Cloud.
//
// Same layout and design system as the Azure console (entraguard.my), with Firestore and
// the Cloud Run analyst as its data sources. Every panel says where its data came from.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  GoogleAuthProvider, getAuth, getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';

const config = await (await fetch('/__/firebase/init.json')).json();
if (location.hostname.endsWith('.web.app') || location.hostname.endsWith('.firebaseapp.com')) config.authDomain = location.hostname;
const auth = getAuth(initializeApp(config));
getRedirectResult(auth).catch(() => {});

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const OUTCOME = {
  passed: ['success', 'Passed'],
  'blocked-coaching': ['error', 'Blocked · coaching'],
  failed: ['warning', 'Failed'],
  'in-progress': ['info', 'In progress'],
  abandoned: ['', 'Not completed'],
};
const VECTORS = {
  in_room_coaching: 'In-room coaching', authority_impersonation: 'Authority impersonation', urgency_pretexting: 'Urgency pretext',
  mfa_fatigue_coaching: 'MFA coaching', otp_elicitation: 'Code elicitation', helpdesk_reset_fraud: 'Help-desk reset fraud',
  remote_access_tooling: 'Remote access tooling', temporary_access_pass_request: 'TAP request', payment_redirect: 'Payment redirect',
  callback_number_swap: 'Callback swap', mfa_method_registration: 'MFA method registration',
};
const SOURCE = { treasury: 'Contoso Treasury', console: 'Console · Try it' };
const MODE = (m) => (!m ? '—' : m === 'microphone' ? 'Microphone' : m.startsWith('script:') ? `Scripted · ${m.slice(7)}` : m);

let state = { hours: 24, data: null, error: null, loading: false, auto: true, filter: '' };
let timer = null;

// ─────────────────────────────────────────────────────────── API
async function api(path) {
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function load() {
  state.loading = true;
  render();
  try {
    state.data = await api(`/operator/overview?hours=${state.hours}`);
    state.error = null;
  } catch (e) {
    state.error = e.message;
  } finally {
    state.loading = false;
    render();
  }
}

function schedule() {
  clearInterval(timer);
  if (state.auto) timer = setInterval(() => { if (!document.hidden && auth.currentUser) load(); }, location.hash.startsWith('#/live') ? 3000 : 8000);
}

// ─────────────────────────────────────────────────────────── shell
const theme = (() => { try { return localStorage.getItem('entraguard.gcp.theme') || 'light'; } catch { return 'light'; } })();
$('portal').dataset.theme = theme;
$('theme').addEventListener('click', () => {
  const next = $('portal').dataset.theme === 'light' ? 'dark' : 'light';
  $('portal').dataset.theme = next;
  try { localStorage.setItem('entraguard.gcp.theme', next); } catch { /* still applies */ }
});
$('account-btn').addEventListener('click', () => {
  const open = $('account-panel').hidden;
  $('account-panel').hidden = !open;
  $('account-btn').setAttribute('aria-expanded', String(open));
});
$('sign-out').addEventListener('click', () => signOut(auth));
$('sign-in').addEventListener('click', async () => {
  const provider = new GoogleAuthProvider();
  try { await signInWithPopup(auth, provider); } catch (e) {
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    await signInWithRedirect(auth, provider);
  }
});
$('record-close').addEventListener('click', () => $('record-dialog').close());

onAuthStateChanged(auth, (user) => {
  $('signin').hidden = Boolean(user);
  $('view').hidden = !user;
  $('account').hidden = !user;
  if (user) {
    $('account-name').textContent = user.displayName || user.email;
    $('account-avatar').textContent = (user.displayName || user.email || 'EG').slice(0, 2).toUpperCase();
    $('account-email').textContent = user.email || '';
    if (!location.hash) location.hash = '#/overview';
    load();
    schedule();
  } else {
    clearInterval(timer);
    state.data = null;
  }
});

window.addEventListener('hashchange', () => { render(); schedule(); });

// ─────────────────────────────────────────────────────────── pieces
const badge = (tone, text) => `<span class="az-badge ${tone}">${esc(text)}</span>`;
const outcomeBadge = (o) => badge(...(OUTCOME[o] ?? ['', o]));
const riskBadge = (r) => (r == null ? '<span class="az-dim">—</span>' : badge(r >= 80 ? 'error' : r >= 60 ? 'severe' : r >= 40 ? 'warning' : '', Math.round(r)));
const time = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
const ago = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};
const source = (label) => `<span class="az-badge" title="Data source: ${esc(label)}"><span class="az-dot"></span>${esc(label)}</span>`;
const card = (title, body, { src = 'Firestore', actions = '', footer = '' } = {}) => `
  <section class="az-card"><header class="az-card-head"><h2 class="az-card-title">${esc(title)}</h2><span style="display:flex;gap:8px;align-items:center">${actions}${src ? source(src) : ''}</span></header>
  <div class="az-card-body">${body}</div>${footer ? `<div class="az-card-foot">${footer}</div>` : ''}</section>`;
const metric = (value, label, tone = '') => `<div class="az-metric"><span class="az-metric-value${tone ? ` t-${tone}` : ''}">${esc(value)}</span><span class="az-metric-label">${esc(label)}</span></div>`;
const empty = (title, detail) => `<div class="az-empty"><strong>${esc(title)}</strong>${esc(detail)}</div>`;

function head(trail, title, subtitle) {
  return `<nav class="az-breadcrumb" aria-label="Breadcrumb"><a href="#/overview">Home</a>${trail.map((t, i) => `<span class="sep">›</span><span${i === trail.length - 1 ? ' aria-current="page"' : ''}>${esc(t)}</span>`).join('')}</nav>
  <div class="az-page-head"><h1 class="az-page-title"><span class="az-res-icon">◆</span>EntraGuard | ${esc(title)}</h1><p class="az-page-sub">${esc(subtitle)}</p></div>`;
}

function commandBar() {
  return `<div class="az-commandbar">
    <button class="az-cmd" type="button" data-act="refresh"${state.loading ? ' disabled' : ''}>⟳ ${state.loading ? 'Refreshing…' : 'Refresh'}</button>
    <button class="az-cmd${state.auto ? ' is-on' : ''}" type="button" data-act="auto">${state.auto ? '● Auto-refresh on' : '○ Auto-refresh off'}</button>
    <span class="az-cmd-sep" aria-hidden="true"></span>
    <span class="az-cmd" style="cursor:default">Time range</span>
    <select class="az-select" data-act="hours" aria-label="Time range">
      ${[1, 24, 72, 168].map((h) => `<option value="${h}"${h === state.hours ? ' selected' : ''}>${h === 1 ? 'Last hour' : h === 168 ? 'Last 7 days' : `Last ${h} hours`}</option>`).join('')}
    </select>
    <span class="az-cmd-sep" aria-hidden="true"></span>
    <a class="az-cmd" href="/try">▶ Try a verification</a>
  </div>`;
}

function essentials(d) {
  const c = d.config;
  const items = [
    ['Google Cloud project', c.project ?? '—'],
    ['Region', c.region ?? 'asia-southeast1'],
    ['Cloud Run service', c.service ? `${c.service} · ${c.revision}` : '—'],
    ['Analyst model', `${c.model} · Vertex AI`],
    ['Refusal rule', `risk ≥ ${c.thresholds.risk} and confidence ≥ ${c.thresholds.confidence}, before the number`],
    ['Your access', d.viewer.operator ? 'Operator — full records' : 'Visitor — your own records in full; others redacted'],
  ];
  return `<div class="az-essentials"><button class="az-essentials-toggle" type="button" aria-expanded="true">▾ Essentials</button>
    <div class="az-essentials-body">${items.map(([k, v]) => `<dl class="az-kv"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></dl>`).join('')}</div></div>`;
}

function activityChart(trend) {
  if (!trend.length) return empty('No verifications in this window', 'The next verification appears here.');
  const max = Math.max(1, ...trend.map((b) => b.passed + b.blocked + b.other));
  const w = 600, h = 170, bw = Math.max(6, Math.min(36, (w - 20) / trend.length - 6));
  const bars = trend.map((b, i) => {
    const x = 10 + i * ((w - 20) / trend.length);
    let y = h - 20;
    return [['passed', 'var(--az-blue)'], ['blocked', 'var(--az-error)'], ['other', 'var(--az-text-3)']].map(([k, color]) => {
      const bh = (b[k] / max) * (h - 40);
      y -= bh;
      return bh > 0 ? `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="${color}"><title>${new Date(b.t).toLocaleString('en-GB')} · ${k}: ${b[k]}</title></rect>` : '';
    }).join('');
  }).join('');
  const first = new Date(trend[0].t), last = new Date(trend.at(-1).t);
  return `<svg class="eg-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Verifications over time">${bars}
    <line x1="0" y1="${h - 20}" x2="${w}" y2="${h - 20}" stroke="var(--az-border)"/>
    <text x="10" y="${h - 4}" class="eg-axis">${first.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</text>
    <text x="${w - 10}" y="${h - 4}" class="eg-axis" text-anchor="end">${last.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</text></svg>
    <div class="eg-legend"><span><i style="background:var(--az-blue)"></i>Passed</span><span><i style="background:var(--az-error)"></i>Blocked · coaching</span><span><i style="background:var(--az-text-3)"></i>Failed / other</span></div>`;
}

function distribution(c) {
  const rows = [['Checks passed', c.passed, 'var(--az-blue)'], ['Coaching blocked', c.blocked, 'var(--az-error)'], ['Failed', c.failed, 'var(--az-warning)'],
    ['In progress', c.inProgress, 'var(--az-blue-light)'], ['Not completed', c.abandoned, 'var(--az-text-3)']];
  const total = Math.max(1, c.total);
  return `<div class="eg-dist">${rows.map(([label, n, color]) => `<div class="eg-dist-row"><span>${esc(label)}</span><div class="eg-dist-bar"><i style="width:${(n / total) * 100}%;background:${color}"></i></div><b>${n}</b></div>`).join('')}</div>`;
}

function recordsTable(rows, { live = false } = {}) {
  const filtered = rows.filter((r) => !state.filter || JSON.stringify(r).toLowerCase().includes(state.filter.toLowerCase()));
  if (!rows.length) return empty(live ? 'No calls in progress' : 'No verifications in this window', live ? 'Start one in Contoso Treasury or Try a verification — it appears here within seconds.' : 'Widen the time range, or run a verification.');
  return `<div class="az-table-toolbar"><input class="az-filter" type="search" placeholder="Filter loaded rows…" value="${esc(state.filter)}" data-act="filter" aria-label="Filter rows"><span class="az-count">${filtered.length} of ${rows.length} loaded rows</span></div>
  <div class="az-table-wrap" role="region" aria-label="Verifications" tabindex="0"><table class="az-table"><thead><tr>
    <th>Time</th><th>Source</th><th>User</th><th>Mode</th><th>Outcome</th><th style="text-align:right">Peak risk</th><th>Tactics</th><th><span class="sr-only">Details</span></th></tr></thead><tbody>
    ${filtered.map((r) => `<tr${r.own ? ' class="eg-own"' : ''}>
      <td title="${esc(r.createdAt)}">${live ? esc(ago(r.createdAt)) : esc(time(r.createdAt))}</td>
      <td>${esc(SOURCE[r.app] ?? r.app)}</td>
      <td>${esc(r.who)}${r.own ? ' <span class="az-badge info">You</span>' : ''}</td>
      <td>${esc(MODE(r.mode))}</td>
      <td>${outcomeBadge(r.outcome)}</td>
      <td style="text-align:right">${riskBadge(r.peakRisk)}</td>
      <td>${r.vectors.length ? r.vectors.slice(0, 2).map((v) => `<span class="eg-tag">${esc(VECTORS[v] ?? v)}</span>`).join(' ') : '<span class="az-dim">None</span>'}</td>
      <td>${r.detail ? `<button type="button" class="admin-table-action" data-record="${esc(r.id)}">View details</button>` : '<span class="az-dim" title="Only the person verified or an operator can open the transcript">Redacted</span>'}</td>
    </tr>`).join('')}
  </tbody></table></div>`;
}

// ─────────────────────────────────────────────────────────── views
function overview(d) {
  const c = d.counts;
  return `${head(['EntraGuard', 'Overview'], 'Overview', 'Verification outcomes and live calls across Contoso Treasury and the console. Read from Firestore through the Cloud Run analyst.')}
  ${commandBar()}
  <div class="az-content">
    ${essentials(d)}
    <div class="admin-section-heading"><h2>Verification summary</h2><span>Last ${state.hours === 168 ? '7 days' : `${state.hours} hours`} · one row per verification</span></div>
    <div class="az-grid c4 admin-kpi">
      ${card('Recorded verifications', metric(c.total.toLocaleString(), 'Every verification started in the window'))}
      ${card('Checks passed', metric(c.passed.toLocaleString(), 'Number and answer correct, no coaching detected'))}
      ${card('Coaching blocked', metric(c.blocked.toLocaleString(), 'Refused by the decision rule, even with the right number', c.blocked ? 'error' : ''))}
      ${card('Failed', metric(c.failed.toLocaleString(), 'Wrong number or wrong answer', c.failed ? 'warning' : ''))}
    </div>
    <div class="az-grid c2">
      ${card('Verification activity', activityChart(d.trend), { footer: 'Bucketed by start time, in your local time zone.' })}
      ${card('Outcome distribution', distribution(c), { footer: 'A failed verification is not automatically a prevented attack.' })}
    </div>
    <div class="az-grid c2">
      ${card('Calls in progress', recordsTable(d.live, { live: true }), { src: 'Firestore · live', actions: '<a href="#/live">Open live view</a>' })}
      ${card('Tactics detected', d.vectors.length
        ? `<div class="eg-dist">${d.vectors.map((v) => `<div class="eg-dist-row"><span>${esc(VECTORS[v.name] ?? v.name)}</span><div class="eg-dist-bar"><i style="width:${(v.count / Math.max(...d.vectors.map((x) => x.count))) * 100}%;background:var(--az-error)"></i></div><b>${v.count}</b></div>`).join('')}</div>`
        : empty('No tactics detected', 'Gemini has not reported a social-engineering tactic in this window.'), { src: 'Gemini · Vertex AI' })}
    </div>
    <div class="admin-section-heading"><h2>Investigate and operate</h2><span>Where each verification comes from</span></div>
    <div class="admin-quicklinks">
      <a class="admin-quicklink" href="#/verifications"><span class="eg-ql">✓</span><span><strong>Verification records</strong><small>Outcomes, reasons, trajectories</small></span></a>
      <a class="admin-quicklink" href="https://placeholders.my" target="_blank" rel="noreferrer"><span class="eg-ql">£</span><span><strong>Contoso Treasury</strong><small>Sign in with Google → verified here</small></span></a>
      <a class="admin-quicklink" href="https://console.cloud.google.com/run/detail/asia-southeast1/entraguard-analyst?project=entraguard-gemini" target="_blank" rel="noreferrer"><span class="eg-ql">☁</span><span><strong>Cloud Run</strong><small>entraguard-analyst revisions and logs</small></span></a>
    </div>
    <p class="admin-meta-note">Gemini supplies evidence; deterministic code decides. A pass means no coaching was detected — not proof it was absent.</p>
  </div>`;
}

function liveView(d) {
  return `${head(['EntraGuard', 'Live calls'], 'Live calls', 'Verifications in progress right now, refreshed every 3 seconds.')}
  ${commandBar()}
  <div class="az-content">${card('Calls in progress', recordsTable(d.live, { live: true }), { src: 'Firestore · live' })}
  ${card('Most recent verifications', recordsTable(d.records.slice(0, 10)))}</div>`;
}

function verificationsView(d) {
  return `${head(['EntraGuard', 'Verification records'], 'Verification records', 'Every verification in the window: who, how, the outcome and the strongest evidence Gemini reported.')}
  ${commandBar()}
  <div class="az-content">${card(`Verifications (${d.records.length})`, recordsTable(d.records))}</div>`;
}

function render() {
  const view = $('view');
  if (!auth.currentUser) return;
  const route = (location.hash.replace('#/', '') || 'overview').split('/')[0];
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (state.data) {
    $('account-role').textContent = state.data.viewer.operator ? 'Operator' : 'Visitor';
    $('account-access').textContent = state.data.viewer.operator ? 'Access: operator (full records)' : 'Access: visitor (others redacted)';
  }
  if (!state.data) {
    view.innerHTML = state.error
      ? `${head(['EntraGuard'], 'Overview', '')}<div class="az-content"><div class="az-msgbar error" role="alert"><b>Could not load.</b> ${esc(state.error)}</div></div>`
      : `${head(['EntraGuard'], 'Overview', 'Loading verifications…')}`;
    return;
  }
  const focused = document.activeElement?.dataset?.act === 'filter';
  view.innerHTML = (route === 'live' ? liveView : route === 'verifications' ? verificationsView : overview)(state.data)
    + (state.error ? `<div class="az-content"><div class="az-msgbar warning"><b>Refresh failed.</b> ${esc(state.error)} Showing the last loaded data.</div></div>` : '');
  if (focused) { const f = view.querySelector('[data-act="filter"]'); f?.focus(); f?.setSelectionRange(f.value.length, f.value.length); }
}

$('view').addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'refresh') load();
  if (act === 'auto') { state.auto = !state.auto; schedule(); render(); }
  const id = e.target.closest('[data-record]')?.dataset.record;
  if (id) openRecord(id);
});
$('view').addEventListener('change', (e) => {
  if (e.target.dataset.act === 'hours') { state.hours = Number(e.target.value); load(); }
});
$('view').addEventListener('input', (e) => {
  if (e.target.dataset.act === 'filter') { state.filter = e.target.value; render(); }
});

// ─────────────────────────────────────────────────────────── record details
function trajectory(events) {
  if (!events.length) return empty('No assessments', 'Gemini did not assess this verification.');
  const w = 600, h = 150, n = Math.max(events.length, 2);
  const x = (i) => 12 + (i / (n - 1)) * (w - 24);
  const y = (r) => h - 10 - (r / 100) * (h - 20);
  const pts = events.map((e, i) => `${x(i)},${y(e.riskScore)}`).join(' ');
  return `<svg class="eg-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Risk over the call">
    <rect x="0" y="0" width="${w}" height="${y(60)}" fill="var(--az-error-bg)" opacity=".6"/>
    <line x1="0" y1="${y(60)}" x2="${w}" y2="${y(60)}" stroke="var(--az-error)" stroke-dasharray="4 4"/>
    <text x="6" y="${y(60) - 5}" class="eg-axis" fill="var(--az-error)">refuse ≥ 60</text>
    <polyline points="${pts}" fill="none" stroke="var(--az-blue)" stroke-width="2.5"/>
    ${events.map((e, i) => `<circle cx="${x(i)}" cy="${y(e.riskScore)}" r="4" fill="${e.riskScore >= 60 && e.confidence >= 0.75 ? 'var(--az-error)' : 'var(--az-blue)'}"><title>risk ${Math.round(e.riskScore)} · confidence ${e.confidence.toFixed(2)} · ${e.latencyMs} ms</title></circle>`).join('')}
  </svg>`;
}

async function openRecord(id) {
  const body = $('record-body');
  body.innerHTML = '<p class="admin-meta-note">Loading…</p>';
  $('record-dialog').showModal();
  try {
    const r = await api(`/operator/sessions/${encodeURIComponent(id)}`);
    const peak = r.peak;
    $('record-title').textContent = `Verification ${r.id.slice(0, 8)}`;
    body.innerHTML = `
      <div class="az-essentials-body eg-detail-kv">
        ${[['Outcome', outcomeBadge(r.verdict?.outcome ?? (r.status === 'live' ? 'in-progress' : 'abandoned'))], ['Source', esc(SOURCE[r.app] ?? r.app)], ['User', esc(r.user?.name || r.user?.email || 'Google user')],
          ['Mode', esc(MODE(r.mode))], ['Started', esc(time(r.createdAt))], ['Peak risk', riskBadge(peak?.riskScore)], ['Question', esc(r.question)]]
          .map(([k, v]) => `<dl class="az-kv"><dt>${k}</dt><dd>${v}</dd></dl>`).join('')}
      </div>
      ${r.verdict ? `<div class="az-msgbar ${r.verdict.outcome === 'passed' ? 'success' : r.verdict.outcome === 'blocked-coaching' ? 'error' : 'warning'}"><b>Decision.</b> ${esc(r.verdict.reason)}${r.verdict.judgeReason ? ` Answer check: ${esc(r.verdict.judgeReason)}` : ''}</div>` : ''}
      <h3 class="eg-h3">Risk trajectory <small>${r.events.length} Gemini assessments</small></h3>
      ${trajectory(r.events)}
      <div class="eg-detail-cols">
        <div><h3 class="eg-h3">Strongest evidence</h3>
          ${peak?.vectors?.length ? `<p>${peak.vectors.map((v) => `<span class="eg-tag">${esc(VECTORS[v] ?? v)}</span>`).join(' ')}</p>` : ''}
          <p>${esc(peak?.rationale ?? 'No assessment.')}</p>
          ${(peak?.evidence ?? []).map((q) => `<blockquote class="eg-quote"><small>${esc(q.speaker)}</small>“${esc(q.quote)}”</blockquote>`).join('')}
        </div>
        <div><h3 class="eg-h3">Transcript</h3>
          <ol class="eg-transcript">${r.lines.map((l) => `<li class="${esc(l.speaker)}"><b>${l.speaker === 'system' ? 'EntraGuard' : 'Room mic'}</b>${esc(l.text)}</li>`).join('') || '<li>Nothing was said.</li>'}</ol>
        </div>
      </div>`;
  } catch (e) {
    body.innerHTML = `<div class="az-msgbar error" role="alert"><b>Could not open.</b> ${esc(e.message)}</div>`;
  }
}
