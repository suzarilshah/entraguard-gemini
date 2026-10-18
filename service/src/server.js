// EntraGuard Gemini analyst — Cloud Run service.
//
// Firebase Hosting rewrites /api/** here. Every route except /api/health requires a
// Firebase Auth ID token, and every session is owned by the uid that created it.
// Firestore is the system of record and the live channel: the browser subscribes to the
// session document and its events, so nothing here needs to push to clients.

import express from 'express';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { decide, isCoerced } from './decision.js';
import { aliasMatch, chooseFact, matchNumber, signInFacts } from './facts.js';
import { assessAudio, assessTranscript, judgeAnswer } from './gemini.js';
import { SCENARIOS, scriptFor, spoken } from './scenarios.js';

initializeApp();
const db = getFirestore();
const auth = getAuth();

// Bounds that keep one judge's curiosity from becoming a bill.
const MAX_AUDIO_CLIPS = 45; // ~3 minutes of 4-second clips
const MAX_WAV_BASE64 = 600_000; // ~4.5 s of 16 kHz mono PCM, with headroom
const MAX_SESSIONS_PER_HOUR = 20;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'entraguard-gemini-analyst' }));

async function requireUser(req, res, next) {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in first.' });
  try {
    req.user = await auth.verifyIdToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Your sign-in has expired. Sign in again.' });
  }
}

const sessions = db.collection('sessions');

async function loadOwned(req, res) {
  const ref = sessions.doc(req.params.id);
  const snap = await ref.get();
  if (!snap.exists || snap.get('uid') !== req.user.uid) {
    res.status(404).json({ error: 'No such verification.' });
    return null;
  }
  if (snap.get('status') !== 'live') {
    res.status(409).json({ error: 'This verification has already finished.' });
    return null;
  }
  return { ref, data: snap.data() };
}

// Record one assessment: an event for the trajectory, plus peak and first-coercion on the
// session. Coercion is sticky — once a window clears both bars, later calm does not erase it.
async function recordAssessment(ref, { assessment, latencyMs, model, source, distinctVoices = null }) {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    const seq = (data.assessments ?? 0) + 1;
    const update = { assessments: seq, updatedAt: FieldValue.serverTimestamp() };
    if (!data.peak || assessment.riskScore > data.peak.riskScore) update.peak = assessment;
    if (!data.coercion && isCoerced(assessment)) update.coercion = assessment;
    tx.update(ref, update);
    tx.create(ref.collection('events').doc(String(seq).padStart(4, '0')), {
      seq,
      at: FieldValue.serverTimestamp(),
      source,
      riskScore: assessment.riskScore,
      confidence: assessment.confidence,
      complianceStage: assessment.complianceStage,
      vectors: assessment.vectors,
      evidence: assessment.evidence,
      rationale: assessment.rationale,
      distinctVoices,
      latencyMs,
      model,
    });
  });
}

function fail(res, error, what) {
  console.error(JSON.stringify({ severity: 'ERROR', message: `${what} failed`, error: String(error?.message ?? error) }));
  res.status(502).json({ error: `${what} failed. Gemini or Firestore did not respond — try again.` });
}

// Start a verification: number to match, plus one question from this very sign-in.
app.post('/api/sessions', requireUser, async (req, res) => {
  try {
    const hourAgo = new Date(Date.now() - 3600_000);
    const recent = await sessions.where('uid', '==', req.user.uid).where('createdAt', '>', hourAgo).count().get();
    if (recent.data().count >= MAX_SESSIONS_PER_HOUR) {
      return res.status(429).json({ error: 'That is a lot of verifications for one hour. Try again later.' });
    }

    const facts = signInFacts(req.get('user-agent') ?? '');
    const fact = chooseFact(facts);
    if (!fact) return res.status(400).json({ error: 'Could not read this browser’s sign-in details.' });

    const number = matchNumber();
    const ref = sessions.doc();
    const batch = db.batch();
    batch.create(ref, {
      uid: req.user.uid,
      status: 'live',
      mode: null,
      number,
      question: fact.question,
      factKind: fact.kind,
      lines: [],
      assessments: 0,
      audioClips: 0,
      peak: null,
      coercion: null,
      verdict: null,
      createdAt: new Date(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    // The expected answer lives where Firestore rules let no client read.
    batch.create(ref.collection('private').doc('answer'), { answer: fact.answer, aliases: fact.aliases });
    await batch.commit();

    res.status(201).json({ id: ref.id, number, question: fact.question });
  } catch (error) {
    fail(res, error, 'Starting the verification');
  }
});

// Microphone path: one ~4-second WAV clip. Gemini transcribes and assesses in one call.
app.post('/api/sessions/:id/audio', requireUser, async (req, res) => {
  const owned = await loadOwned(req, res);
  if (!owned) return;
  const wav = req.body?.wav;
  if (typeof wav !== 'string' || wav.length === 0 || wav.length > MAX_WAV_BASE64) {
    return res.status(400).json({ error: 'Audio clip missing or too long.' });
  }
  if ((owned.data.audioClips ?? 0) >= MAX_AUDIO_CLIPS) {
    return res.status(429).json({ error: 'This call has reached its length limit. Finish the verification.' });
  }
  try {
    await owned.ref.update({ mode: 'microphone', audioClips: FieldValue.increment(1) });
    const result = await assessAudio(owned.data.lines ?? [], wav);
    if (result.transcript) {
      await owned.ref.update({ lines: FieldValue.arrayUnion({ speaker: 'user', text: result.transcript, at: Date.now() }) });
    }
    await recordAssessment(owned.ref, { ...result, source: 'microphone' });
    res.json({ transcript: result.transcript, assessment: result.assessment, distinctVoices: result.distinctVoices });
  } catch (error) {
    fail(res, error, 'Assessing the audio');
  }
});

// Scripted path: the browser asks for the next line; the server owns the script and the pace.
app.post('/api/sessions/:id/script', requireUser, async (req, res) => {
  const owned = await loadOwned(req, res);
  if (!owned) return;
  const name = req.body?.scenario;
  if (!SCENARIOS[name]) return res.status(400).json({ error: 'Unknown scenario.' });
  if (owned.data.mode && owned.data.mode !== `script:${name}`) {
    return res.status(409).json({ error: 'This verification is already running a different call. Start a new one.' });
  }
  try {
    const answer = (await owned.ref.collection('private').doc('answer').get()).get('answer');
    const script = scriptFor(name, { number: owned.data.number, answer, question: owned.data.question });
    const lines = owned.data.lines ?? [];
    if (lines.length >= script.length) return res.json({ done: true });

    const line = { ...script[lines.length], at: Date.now() };
    const next = [...lines, line];
    await owned.ref.update({ mode: `script:${name}`, lines: next });

    // The system's own prompts are never evidence; assess after each human line.
    let assessment = null;
    if (line.speaker !== 'system') {
      const result = await assessTranscript(next);
      await recordAssessment(owned.ref, { ...result, source: 'script' });
      assessment = result.assessment;
    }
    // The scripted user keys in the number at the moment they say it.
    const entersNumber = line.speaker === 'user' && line.text.includes(spoken(owned.data.number));
    res.json({ done: next.length >= script.length, line, assessment, enteredNumber: entersNumber ? owned.data.number : null });
  } catch (error) {
    fail(res, error, 'Running the scripted call');
  }
});

// Finish: knowledge check, then the deterministic decision.
app.post('/api/sessions/:id/finish', requireUser, async (req, res) => {
  const owned = await loadOwned(req, res);
  if (!owned) return;
  try {
    const { answer, aliases } = (await owned.ref.collection('private').doc('answer').get()).data();
    const fact = { answer, aliases };
    const said = [
      ...(owned.data.lines ?? []).filter((l) => l.speaker === 'user').map((l) => l.text),
      typeof req.body?.typedAnswer === 'string' ? req.body.typedAnswer.slice(0, 200) : '',
    ].join(' ').trim();

    let answerMatched = aliasMatch(said, fact);
    let judgeReason = answerMatched ? 'The correct answer was stated.' : null;
    if (!answerMatched && said) {
      const judged = await judgeAnswer({ question: owned.data.question, answer, said });
      answerMatched = judged.matched;
      judgeReason = judged.reason;
    }
    if (!said) judgeReason = 'No answer was given.';

    const verdict = {
      ...decide({
        expectedNumber: owned.data.number,
        enteredNumber: req.body?.enteredNumber ?? null,
        coercion: owned.data.coercion,
        answerMatched,
      }),
      judgeReason,
      peakRisk: owned.data.peak?.riskScore ?? null,
      decidedAt: new Date(),
    };
    await owned.ref.update({
      status: verdict.outcome === 'passed' ? 'passed' : 'refused',
      verdict,
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(JSON.stringify({
      severity: verdict.outcome === 'blocked-coaching' ? 'WARNING' : 'INFO',
      message: 'verification decided',
      logName: 'entraguard-verdicts',
      session: owned.ref.id,
      outcome: verdict.outcome,
      peakRisk: verdict.peakRisk,
      mode: owned.data.mode,
    }));
    res.json({ verdict });
  } catch (error) {
    fail(res, error, 'Finishing the verification');
  }
});

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => console.log(`entraguard-gemini-analyst listening on ${port}`));
