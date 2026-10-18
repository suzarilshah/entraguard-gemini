// The verification decision.
//
// A pure function of (expected number, entered number, coercion finding, answer result),
// ported from VerificationAdjudicator.cs in the main EntraGuard repository so the Gemini
// build refuses on exactly the same rule. Gemini supplies evidence; this file holds the
// authority. Nothing the model returns can grant access on its own.

/** Analyst risk at which a verification is refused even with the right number. */
export const COERCION_RISK_THRESHOLD = 60;

/** Confidence required before coercion is acted on. */
export const COERCION_CONFIDENCE_THRESHOLD = 0.75;

/** True when a single assessment clears both bars. */
export function isCoerced(assessment) {
  return (
    assessment != null &&
    Number(assessment.riskScore) >= COERCION_RISK_THRESHOLD &&
    Number(assessment.confidence) >= COERCION_CONFIDENCE_THRESHOLD
  );
}

/**
 * Decide a finished verification.
 *
 * Coercion is evaluated BEFORE the number, deliberately. A coached user normally enters
 * the correct digits — that is what coaching produces — so checking the number first and
 * returning early on a match would let every coerced attempt straight through.
 *
 * @param {object} input
 * @param {string|number} input.expectedNumber
 * @param {string|number|null} input.enteredNumber
 * @param {object|null} input.coercion  first assessment that cleared both thresholds, if any
 * @param {boolean} input.answerMatched result of the knowledge check
 */
export function decide({ expectedNumber, enteredNumber, coercion, answerMatched }) {
  const numberCorrect =
    enteredNumber != null && String(enteredNumber).trim() === String(expectedNumber);

  if (isCoerced(coercion)) {
    const vectors = (coercion.vectors ?? []).join(', ');
    const lead = numberCorrect
      ? 'The number was correct, but'
      : 'The number was incorrect, and separately';
    return {
      outcome: 'blocked-coaching',
      numberCorrect,
      answerMatched: Boolean(answerMatched),
      reason:
        `${lead} EntraGuard detected the user was being coached during the verification ` +
        `(risk ${Math.round(coercion.riskScore)}/100, confidence ` +
        `${Math.round(coercion.confidence * 100)}%${vectors ? `, ${vectors}` : ''}). Access was refused.`,
    };
  }

  if (!numberCorrect) {
    return {
      outcome: 'failed',
      numberCorrect,
      answerMatched: Boolean(answerMatched),
      reason: 'Incorrect number match.',
    };
  }

  if (!answerMatched) {
    return {
      outcome: 'failed',
      numberCorrect,
      answerMatched: false,
      reason: 'The number was correct, but the identity question was not answered correctly.',
    };
  }

  return {
    outcome: 'passed',
    numberCorrect,
    answerMatched: true,
    reason: 'Number match confirmed and the identity question answered. No coercion detected.',
  };
}
