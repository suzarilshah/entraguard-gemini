import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  GoogleAuthProvider, getAuth, onAuthStateChanged, signInWithPopup, signOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  collection, doc, getFirestore, onSnapshot, orderBy, query,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { startMicrophone } from './mic.js';

// Firebase Hosting serves this project's web config at a reserved URL, so no keys or IDs
// are committed to the repository.
const config = await (await fetch('/__/firebase/init.json')).json();
const app = initializeApp(config);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => { $(id).hidden = !on; };

const STAGES = { unaware: 'Unaware', engaged: 'Engaged', about_to_approve: 'About to approve', approved: 'Complied' };
const VECTOR_LABELS = {
  in_room_coaching: 'In-room coaching', authority_impersonation: 'Authority impersonation',
  urgency_pretexting: 'Urgency pretext', mfa_fatigue_coaching: 'MFA coaching', otp_elicitation: 'Code elicitation',
  helpdesk_reset_fraud: 'Help-desk reset fraud', remote_access_tooling: 'Remote access tooling',
  temporary_access_pass_request: 'TAP request', payment_redirect: 'Payment redirect',
  callback_number_swap: 'Callback swap', mfa_method_registration: 'MFA method registration',
};

let session = null; // { id, number, question }
let unsubscribers = [];
let mic = null;
let running = false;

// ---------------------------------------------------------------- API
async function api(path, body) {
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body ?? {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function showError(id, error) {
  $(id).textContent = error?.message ?? String(error);
  show(id, true);
}

// ---------------------------------------------------------------- auth
$('sign-in').addEventListener('click', async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e) { if (e.code !== 'auth/popup-closed-by-user') alert(e.message); }
});
$('sign-out').addEventListener('click', () => { reset(); signOut(auth); });

onAuthStateChanged(auth, (user) => {
  show('who', Boolean(user));
  show('landing', !user);
  show('start', Boolean(user) && !session);
  show('verify', Boolean(user) && Boolean(session));
  if (user) $('who-name').textContent = user.displayName || user.email;
});

// ---------------------------------------------------------------- start
$('start-btn').addEventListener('click', async () => {
  show('start-error', false);
  $('start-btn').disabled = true;
  try {
    session = await api('/sessions');
    $('number').textContent = session.number;
    $('question').textContent = session.question;
    show('start', false);
    show('verify', true);
    subscribe(session.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    showError('start-error', e);
  } finally {
    $('start-btn').disabled = false;
  }
});

$('again').addEventListener('click', () => { reset(); show('verify', false); show('start', true); });

function reset() {
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
  mic?.stop();
  mic = null;
  running = false;
  session = null;
  $('entered').value = '';
  $('typed').value = '';
  $('verdict').hidden = true;
  $('verdict').className = 'verdict';
  $('finish-btn').disabled = false;
  $('mic-btn').disabled = false;
  $('mic-btn').textContent = 'Start talking';
  $('mic-btn').classList.remove('recording');
  document.querySelectorAll('.script').forEach((b) => { b.disabled = false; });
  show('call-error', false);
  renderEvents([]);
  renderLines([]);
  setSteps({});
}

// ---------------------------------------------------------------- live view (Firestore)
function subscribe(id) {
  const ref = doc(db, 'sessions', id);
  unsubscribers.push(onSnapshot(ref, (snap) => {
    const data = snap.data();
    if (!data) return;
    renderLines(data.lines ?? []);
    setSteps({
      call: (data.lines ?? []).length > 0,
      number: $('entered').value.length === 2,
      answer: (data.lines ?? []).some((l) => l.speaker === 'user'),
      decide: Boolean(data.verdict),
    });
    if (data.verdict) renderVerdict(data.verdict);
  }));
  unsubscribers.push(onSnapshot(query(collection(ref, 'events'), orderBy('seq')), (snap) => {
    renderEvents(snap.docs.map((d) => d.data()));
  }));
}

function setSteps(state) {
  let activeSet = false;
  document.querySelectorAll('#steps li').forEach((li) => {
    const done = Boolean(state[li.dataset.step]);
    li.classList.toggle('done', done);
    li.classList.toggle('active', !done && !activeSet && (activeSet = true));
  });
}

function renderLines(lines) {
  const list = $('transcript');
  list.replaceChildren();
  if (lines.length === 0) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'The call has not started.';
    list.append(li);
    return;
  }
  for (const line of lines) {
    const li = document.createElement('li');
    li.className = line.speaker;
    const who = document.createElement('b');
    who.textContent = line.speaker === 'system' ? 'EntraGuard' : line.speaker === 'caller' ? 'Caller' : 'Room mic';
    li.append(who, document.createTextNode(line.text));
    list.append(li);
  }
  list.scrollTop = list.scrollHeight;
}

function renderEvents(events) {
  const W = 600, H = 160;
  const n = Math.max(events.length, 8);
  const x = (i) => (events.length === 1 ? W / 2 : (i / (n - 1)) * (W - 20) + 10);
  const y = (risk) => H - (risk / 100) * (H - 8) - 4;
  $('line').setAttribute('points', events.map((e, i) => `${x(i)},${y(e.riskScore)}`).join(' '));
  const points = $('points');
  points.replaceChildren();
  events.forEach((e, i) => {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', x(i)); c.setAttribute('cy', y(e.riskScore)); c.setAttribute('r', 4);
    if (e.riskScore >= 60 && e.confidence >= 0.75) c.classList.add('hit');
    points.append(c);
  });

  const last = events.at(-1);
  $('risk').textContent = last ? Math.round(last.riskScore) : '–';
  $('conf').textContent = last ? last.confidence.toFixed(2) : '–';
  $('stage').textContent = last ? STAGES[last.complianceStage] ?? last.complianceStage : '–';
  $('latency').textContent = last ? `${(last.latencyMs / 1000).toFixed(1)} s` : '–';

  // Show the strongest evidence seen so far, not just the latest window.
  const peak = events.reduce((best, e) => (!best || e.riskScore > best.riskScore ? e : best), null);
  const vectors = $('vectors');
  vectors.replaceChildren();
  const seen = [...new Set(events.flatMap((e) => e.vectors ?? []))];
  if (seen.length === 0) {
    const span = document.createElement('span');
    span.className = 'muted';
    span.textContent = events.length ? 'No social-engineering tactics detected.' : 'Nothing yet.';
    vectors.append(span);
  }
  for (const v of seen) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = VECTOR_LABELS[v] ?? v;
    vectors.append(chip);
  }
  const voices = events.map((e) => e.distinctVoices).filter((v) => Number.isFinite(v));
  const maxVoices = voices.length ? Math.max(...voices) : null;
  $('rationale').textContent = peak
    ? `${peak.rationale}${maxVoices > 1 ? ` · Gemini heard ${maxVoices} distinct voices in one clip.` : ''}`
    : '';
  const evidence = $('evidence');
  evidence.replaceChildren();
  for (const q of (peak?.evidence ?? []).slice(0, 4)) {
    const li = document.createElement('li');
    const who = document.createElement('small');
    who.textContent = q.speaker;
    li.append(who, document.createTextNode(`“${q.quote}”`));
    evidence.append(li);
  }
}

function renderVerdict(v) {
  const box = $('verdict');
  const passed = v.outcome === 'passed';
  box.className = `verdict ${passed ? 'passed' : 'refused'}`;
  $('verdict-title').textContent = passed
    ? 'Verified — access granted'
    : v.outcome === 'blocked-coaching' ? 'Blocked for your protection' : 'Verification failed';
  $('verdict-reason').textContent = v.reason;
  $('verdict-sub').textContent = [
    v.outcome === 'blocked-coaching'
      ? 'If someone asked you to do this, hang up and contact your help desk on a number you already know.'
      : null,
    v.judgeReason ? `Answer check: ${v.judgeReason}` : null,
    Number.isFinite(v.peakRisk) ? `Peak risk during the call: ${Math.round(v.peakRisk)}.` : null,
  ].filter(Boolean).join(' ');
  box.hidden = false;
  $('finish-btn').disabled = true;
  $('mic-btn').disabled = true;
  document.querySelectorAll('.script').forEach((b) => { b.disabled = true; });
}

// ---------------------------------------------------------------- modes
document.querySelectorAll('.mode').forEach((tab) => tab.addEventListener('click', () => {
  if (running) return;
  document.querySelectorAll('.mode').forEach((t) => {
    const on = t === tab;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('.mode-body').forEach((b) => { b.hidden = b.dataset.body !== tab.dataset.mode; });
}));

// keypad
$('keypad').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const input = $('entered');
  input.value = b.classList.contains('clear') ? input.value.slice(0, -1) : (input.value + b.textContent).slice(0, 2);
});
$('entered').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 2); });

// microphone
$('mic-btn').addEventListener('click', async () => {
  show('call-error', false);
  if (mic) {
    $('mic-btn').disabled = true;
    $('mic-btn').textContent = 'Sending last clip…';
    await mic.stop();
    mic = null;
    running = false;
    $('mic-btn').disabled = false;
    $('mic-btn').textContent = 'Start talking';
    $('mic-btn').classList.remove('recording');
    return;
  }
  try {
    running = true;
    mic = await startMicrophone({
      onLevel: (level) => { $('meter').style.width = `${Math.round(level * 100)}%`; },
      onClip: async (wav) => {
        try { await api(`/sessions/${session.id}/audio`, { wav }); } catch (e) { showError('call-error', e); }
      },
    });
    $('mic-btn').textContent = 'Stop talking';
    $('mic-btn').classList.add('recording');
  } catch (e) {
    running = false;
    showError('call-error', new Error(`Microphone unavailable: ${e.message}. Try a scripted call instead.`));
  }
});

// scripted calls
document.querySelectorAll('.script').forEach((button) => button.addEventListener('click', async () => {
  if (running) return;
  running = true;
  show('call-error', false);
  document.querySelectorAll('.script').forEach((b) => { b.disabled = true; });
  $('finish-btn').disabled = true;
  try {
    for (;;) {
      const step = await api(`/sessions/${session.id}/script`, { scenario: button.dataset.scenario });
      if (step.enteredNumber && !$('entered').value) $('entered').value = step.enteredNumber;
      if (step.done) break;
      await new Promise((r) => setTimeout(r, step.line?.speaker === 'system' ? 900 : 600));
    }
    $('finish-btn').disabled = false;
    await finish();
  } catch (e) {
    showError('call-error', e);
    $('finish-btn').disabled = false;
  } finally {
    running = false;
  }
}));

// finish
async function finish() {
  show('call-error', false);
  if (mic) { await mic.stop(); mic = null; $('mic-btn').classList.remove('recording'); }
  $('finish-btn').disabled = true;
  $('finish-btn').textContent = 'Deciding…';
  try {
    const { verdict } = await api(`/sessions/${session.id}/finish`, {
      enteredNumber: $('entered').value || null,
      typedAnswer: $('typed').value || '',
    });
    renderVerdict(verdict);
  } catch (e) {
    showError('call-error', e);
    $('finish-btn').disabled = false;
  } finally {
    $('finish-btn').textContent = 'Finish verification';
    running = false;
  }
}
$('finish-btn').addEventListener('click', finish);
