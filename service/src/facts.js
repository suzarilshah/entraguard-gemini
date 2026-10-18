// Questions built from the user's own sign-in, seconds earlier.
//
// The main EntraGuard product reads these facts from Microsoft Graph sign-in logs. A Google
// account has no directory behind it, so this build records the facts itself at the moment
// the verification starts: which browser and which operating system the sign-in came from.
// The expected answer never leaves the server.

const BROWSERS = [
  { test: /Edg(e|A|iOS)?\//, name: 'Microsoft Edge', aliases: ['edge', 'microsoft edge'] },
  { test: /OPR\/|Opera/, name: 'Opera', aliases: ['opera'] },
  { test: /SamsungBrowser\//, name: 'Samsung Internet', aliases: ['samsung internet', 'samsung'] },
  { test: /Firefox\/|FxiOS\//, name: 'Firefox', aliases: ['firefox', 'mozilla'] },
  { test: /Chrome\/|CriOS\//, name: 'Google Chrome', aliases: ['chrome', 'google chrome'] },
  { test: /Safari\//, name: 'Safari', aliases: ['safari'] },
];

const SYSTEMS = [
  { test: /iPhone|iPad|iPod/, name: 'iOS', aliases: ['ios', 'iphone', 'ipad', 'apple'] },
  { test: /Android/, name: 'Android', aliases: ['android'] },
  { test: /CrOS/, name: 'ChromeOS', aliases: ['chromeos', 'chrome os', 'chromebook'] },
  { test: /Mac OS X|Macintosh/, name: 'macOS', aliases: ['macos', 'mac os', 'mac', 'macbook', 'apple', 'os x'] },
  { test: /Windows/, name: 'Windows', aliases: ['windows', 'microsoft windows', 'pc'] },
  { test: /Linux/, name: 'Linux', aliases: ['linux', 'ubuntu'] },
];

function match(table, userAgent) {
  return table.find((entry) => entry.test.test(userAgent)) ?? null;
}

/** Facts available about this sign-in, from its user agent. */
export function signInFacts(userAgent = '') {
  const browser = match(BROWSERS, userAgent);
  const system = match(SYSTEMS, userAgent);
  const facts = [];
  if (browser) {
    facts.push({
      kind: 'browser',
      question: 'Which web browser did you use to sign in just now?',
      answer: browser.name,
      aliases: browser.aliases,
    });
  }
  if (system) {
    facts.push({
      kind: 'os',
      question: 'Which operating system is the device you signed in from running?',
      answer: system.name,
      aliases: system.aliases,
    });
  }
  return facts;
}

/** Pick one fact to ask about. Deterministic given the random source, so it is testable. */
export function chooseFact(facts, random = Math.random) {
  if (facts.length === 0) return null;
  return facts[Math.floor(random() * facts.length) % facts.length];
}

/** Two-digit number for the browser to show and the call to collect. */
export function matchNumber(random = Math.random) {
  return String(10 + Math.floor(random() * 90));
}

/**
 * Fast path for the knowledge check: an exact alias, as a whole word, anywhere in what the
 * user said. Gemini is only asked when this does not settle it ("the Google one").
 */
export function aliasMatch(text, fact) {
  if (!text || !fact) return false;
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')} `;
  return [fact.answer, ...fact.aliases].some((alias) => {
    const needle = alias.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
    return needle.length > 0 && haystack.includes(` ${needle} `);
  });
}
