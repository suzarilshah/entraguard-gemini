// Scripted verification calls, for judges who cannot (or would rather not) use a microphone.
//
// Both follow the shape of a call EntraGuard places: there is one microphone, so everything
// said in the room arrives as [USER]. They reach the same number and the same correct answer.
// The only difference is whether somebody else is supplying them — which is the whole point.
// A detector you only ever watch fire is a detector you cannot evaluate, so the genuine call
// is not optional.

const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

export function spoken(number) {
  return String(number)
    .split('')
    .map((d) => DIGITS[Number(d)])
    .join(' ');
}

export const SCENARIOS = {
  coached: {
    title: 'Coached in the room',
    description:
      'The Scattered Spider playbook: the "IT support" call already happened and the attacker is standing beside the user, talking them through it.',
    expectation: 'Refused for coaching, even though the number and the answer are both correct.',
    lines: ({ number, answer, question }) => [
      ['system', `This is EntraGuard calling for Contoso Treasury. Please enter the number shown on your screen.`],
      ['user', `Hang on, it's asking me for a number now.`],
      ['user', `It's fine, I'm from IT support, this is the re-verification I mentioned. Just type the number on the screen, it's ${spoken(number)}.`],
      ['user', `Okay. ${spoken(number)}. Done.`],
      ['system', `Thank you. ${question}`],
      ['user', `Um. I'm not sure what it means.`],
      ['user', `Just say ${answer}, that's what it wants. Don't worry about it, this is completely normal.`],
      ['user', `${answer}.`],
      ['user', `Can you just authenticate me please? IT is waiting on me.`],
    ],
  },
  genuine: {
    title: 'Genuine user, alone',
    description: 'The same verification, answered by the user on their own, with ordinary hesitation.',
    expectation: 'Passes. Risk should stay under 40.',
    lines: ({ number, answer, question }) => [
      ['system', `This is EntraGuard calling for Contoso Treasury. Please enter the number shown on your screen.`],
      ['user', `Okay, one second, let me find it.`],
      ['user', `${spoken(number)}. Entered.`],
      ['system', `Thank you. ${question}`],
      ['user', `Hmm, let me think. I signed in a minute ago...`],
      ['user', `It was ${answer}.`],
      ['user', `Yes, ${answer}. Is that everything?`],
    ],
  },
};

/** The script for one session, with that session's number and expected answer filled in. */
export function scriptFor(name, context) {
  const scenario = SCENARIOS[name];
  if (!scenario) return null;
  return scenario.lines(context).map(([speaker, text]) => ({ speaker, text }));
}
