// Gemini on Vertex AI.
//
// Two ways in, chosen by configuration:
//   - GEMINI_API_KEY set: Vertex AI express mode (key held in Secret Manager, never in code).
//   - otherwise: the Cloud Run service account through Application Default Credentials.
// Every call asks for a strict response schema, so there is no parse-failure path mid-call.

import { GoogleGenAI } from '@google/genai';
import {
  ANALYST_PROMPT,
  ASSESSMENT_SCHEMA,
  AUDIO_ADDENDUM,
  AUDIO_ASSESSMENT_SCHEMA,
  JUDGE_PROMPT,
  JUDGE_SCHEMA,
} from './prompt.js';

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

let client;
function ai() {
  if (!client) {
    client = process.env.GEMINI_API_KEY
      ? new GoogleGenAI({ vertexai: true, apiKey: process.env.GEMINI_API_KEY })
      : new GoogleGenAI({
          vertexai: true,
          project: process.env.GOOGLE_CLOUD_PROJECT,
          // The global endpoint spreads load across regions: far fewer 429s than one region.
          location: process.env.GEMINI_LOCATION || 'global',
        });
  }
  return client;
}

const LABELS = { system: 'VERIFICATION SYSTEM', user: 'USER', caller: 'CALLER' };

/** The rolling window the Analyst sees: the last N labelled lines. */
export function transcriptWindow(lines, max = 14) {
  return lines
    .slice(-max)
    .map((l) => `[${LABELS[l.speaker] ?? 'UNKNOWN'}] ${l.text}`)
    .join('\n');
}

const RETRYABLE = new Set([429, 500, 503]);

// Vertex AI's shared quota answers 429 under contention. A verdict a second late is fine;
// a dropped assessment mid-call is not, so retry with jittered backoff before giving up.
async function withRetry(call, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const status = error?.status ?? error?.code;
      if (attempt >= attempts || !RETRYABLE.has(status)) throw error;
      await new Promise((r) => setTimeout(r, 2 ** (attempt - 1) * 800 + Math.random() * 400));
    }
  }
}

async function generate({ system, parts, schema }) {
  const started = Date.now();
  const response = await withRetry(() => ai().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction: system,
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature: 0,
      // Latency is the product here: a verdict that arrives after the user hangs up is worth
      // nothing. The schema and the prompt carry the reasoning; no extended thinking.
      thinkingConfig: { thinkingBudget: 0 },
    },
  }));
  const text = response.text;
  if (!text) throw new Error('Gemini returned no content');
  return { value: JSON.parse(text), latencyMs: Date.now() - started, model: MODEL };
}

function clamp(a) {
  return {
    ...a,
    riskScore: Math.max(0, Math.min(100, Number(a.riskScore) || 0)),
    confidence: Math.max(0, Math.min(1, Number(a.confidence) || 0)),
    vectors: a.vectors ?? [],
    evidence: a.evidence ?? [],
  };
}

/** Assess a transcript (scripted calls). */
export async function assessTranscript(lines) {
  const { value, latencyMs, model } = await generate({
    system: ANALYST_PROMPT,
    schema: ASSESSMENT_SCHEMA,
    parts: [{ text: `Transcript so far:\n${transcriptWindow(lines)}` }],
  });
  return { assessment: clamp(value), latencyMs, model };
}

/** Transcribe a microphone clip and assess the whole conversation in one call. */
export async function assessAudio(lines, wavBase64) {
  const { value, latencyMs, model } = await generate({
    system: `${ANALYST_PROMPT}\n\n${AUDIO_ADDENDUM}`,
    schema: AUDIO_ASSESSMENT_SCHEMA,
    parts: [
      { text: `Transcript before this clip:\n${transcriptWindow(lines) || '(nothing yet)'}` },
      { inlineData: { mimeType: 'audio/wav', data: wavBase64 } },
    ],
  });
  const { transcript, distinctVoices, ...assessment } = value;
  return {
    transcript: (transcript ?? '').trim(),
    distinctVoices: Number.isFinite(distinctVoices) ? distinctVoices : null,
    assessment: clamp(assessment),
    latencyMs,
    model,
  };
}

/** Semantic answer check, used only when an exact alias did not settle it. */
export async function judgeAnswer({ question, answer, said }) {
  const { value } = await generate({
    system: JUDGE_PROMPT,
    schema: JUDGE_SCHEMA,
    parts: [{ text: `Question: ${question}\nCorrect answer: ${answer}\nThe user said: ${said || '(nothing)'}` }],
  });
  return { matched: Boolean(value.matched), reason: String(value.reason ?? '') };
}
