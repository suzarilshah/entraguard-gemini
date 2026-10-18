# EntraGuard · Gemini

**Your MFA proves someone has the phone. It cannot tell you who is standing next to them.**

This is the Google Cloud half of [EntraGuard](https://github.com/suzarilshah/EntraGuard): the part that **listens to a verification call and refuses when somebody is coaching the user — even when the number they enter is correct.** It is built on **Cloud Run, Firebase, Firestore and Gemini**, and is the entry for the Google Cloud **AI Builder Cup** (theme: *BFSI — Intelligent Risk, Fraud & Financial Experiences*).

> **Live demo:** https://entraguard-gemini.web.app — sign in with any Google account.

---

## The problem

In 2023 attackers got into MGM Resorts and Caesars by **phoning the help desk**. Every control worked as designed: a normal sign-in, an MFA prompt approved by the real user. Scattered Spider has repeated it across dozens of organisations since.

Push, OTP and number matching all prove *possession*. None of them can tell that the person approving is being talked through it by someone beside them. That call is where the compromise happens — and nothing in the identity stack is listening to it.

## What the demo does

1. **Sign in with Google** (Firebase Authentication).
2. **Start a verification.** Your browser shows a two-digit number. EntraGuard asks one question built from the sign-in you just made — which browser, or which operating system. The question did not exist until the call began, and the expected answer never leaves the server.
3. **Talk, or play a scripted call.**
   - **Microphone:** ~4-second clips go to **Gemini**, which transcribes them *and* assesses the whole conversation in one structured call — including how many distinct voices it can hear in the room.
   - **Scripted:** two calls that reach the *same* number and the *same* correct answer. In one, the user is alone. In the other, somebody in the room is feeding them the answers.
4. **Watch the risk live.** Every assessment is written to **Firestore**; the page subscribes and draws the trajectory as it happens.
5. **The decision.** Deterministic code — not the model — refuses when any assessment reaches **risk ≥ 60 with confidence ≥ 0.75**, *before* it looks at whether the number was right. A coached user normally enters the correct digits; that is what coaching produces.

| Scripted call | Number | Answer | Peak risk (gemini-2.5-flash) | Outcome |
|---|---|---|---|---|
| Genuine user, alone | correct | correct | 0 | **Passed** |
| Coached in the room | correct | correct | 95, confidence 0.9 | **Blocked for your protection** |

*Measured during development on 18 October 2026, one run each. A detector you only ever watch fire is a detector you cannot evaluate — so the genuine call matters as much as the coached one.*

## How it uses Google Cloud

| | |
|---|---|
| **Gemini (Vertex AI)** | The Analyst: a strict-schema `RiskAssessment` (risk, confidence, compliance stage, tactic labels, **verbatim** evidence quotes, rationale) every few seconds. Hears microphone audio directly, so it can report a second voice a transcript cannot carry. Also the semantic judge for spoken answers ("the Google one" → Google Chrome). |
| **Cloud Run** | `entraguard-analyst` — the API, the Gemini calls and the decision code. Scales to zero; runs as a dedicated least-privilege service account. |
| **Firestore** | One document per verification plus an `events` sub-collection for the risk trajectory — the system of record *and* the live channel to the browser. Security rules let a user read only their own verification; the expected answer is unreadable by any client; all writes go through Cloud Run. |
| **Firebase** | Authentication (Google sign-in), Hosting for the page, and the `/api/**` rewrite to Cloud Run. |

```
Browser (Firebase Hosting) ──Google sign-in──▶ Firebase Auth
   │  /api/** (ID token)                       ▲
   ▼                                           │ live snapshots
Cloud Run: entraguard-analyst ──writes──▶ Firestore
   │  strict JSON schema
   ▼
Gemini on Vertex AI
```

## Authority stays in code

`service/src/decision.js` is ported from `VerificationAdjudicator.cs` in the main repository and is covered by `service/test/`. Gemini supplies evidence; it never grants or denies anything. A high risk score without confidence does nothing, and every reported tactic must carry a verbatim quote.

## Relationship to the main EntraGuard repository

The main repository is the full product on Microsoft Azure: Communication Services calls (Teams, browser and handset endpoints), Azure AI Speech, an Entra ID **External Authentication Method** so one Conditional Access policy protects every app in a tenant, and the **Contoso Treasury** demo bank. This repository brings the detection and decision path to Google Cloud and lets anyone with a Google account try it — the main product's questions come from Microsoft Graph sign-in logs, which a Google account does not have, so here the sign-in facts are recorded at the moment the verification starts.

## What this does not claim

- **The microphone page is not a phone call.** In production the call reaches the user's enrolled phone; here the "call" panel sits beside the browser so you can try it in one tab.
- **A pass is not proof coercion was absent** — only that none was detected.
- **One microphone cannot separate speakers.** Gemini's voice count is reported and shown, but the decision rests on quotable coaching, not on the count.
- Microphone audio is sent to Gemini for assessment and not stored; transcripts are kept with the verification.

## Run and deploy

```bash
cd service && npm install && npm test        # decision, question and script tests

PROJECT=<firebase-project-id> ./scripts/deploy.sh
```

`deploy.sh` enables the APIs, creates the `entraguard-analyst` service account (Firestore user, Vertex AI user, log writer), deploys Cloud Run from source, then deploys Firestore rules/indexes and Hosting. By default Gemini is called with the service account's own identity — **no key**. `USE_API_KEY=1` switches to a Vertex AI express-mode key held in Secret Manager.

## Licence

MIT
