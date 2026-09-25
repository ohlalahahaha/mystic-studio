'use strict';
// polish — the self-improving design loop: review a URL, hand the TOP 3 FIXES to the
// coding runner on the repo, delta-recheck, repeat until SHIP or a cap hits.
// Pure orchestration: no network, no child processes, no fs — everything arrives via api.

const MAX_ROUNDS_CAP = 6;
const DEFAULT_BUDGET_MIN = 40;
const RESULT_LAW = 'RESULT: SHIP | NEEDS ATTENTION — fix | NO-GO — why';

function verdictLine(text) {
  const lines = String(text || '').split('\n');
  return (lines.find((l) => /^\s*VERDICT:/i.test(l)) || lines[0] || '').trim();
}
function isShip(text) { return /VERDICT:\s*SHIP\b/i.test(String(text || '')); }

// Everything from the "TOP 3 FIXES" marker to the next ALL-CAPS section header or end.
function topFixes(text) {
  const s = String(text || '');
  // Case-insensitive: verdict prompts ask for "TOP 3 FIXES" but models frequently
  // answer "Top 3 fixes:" — losing the block starves the whole polish loop.
  const m = s.match(/TOP 3 FIXES\s*:?\s*/i);
  if (!m) return '';
  const kept = [];
  for (const l of s.slice(m.index + m[0].length).split('\n')) {
    if (/^\s*[A-Z][A-Z0-9 \-\/&()']{1,30}:(\s|$)/.test(l)) break;
    kept.push(l);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Delta says every fix is still fully OPEN and nothing changed at all.
function stalled(delta) {
  const txt = String(delta || '');
  const landed = (txt.match(/\b(?:DONE|PARTIAL)\b/g) || []).length;
  const open = (txt.match(/\bOPEN\b/g) || []).length;
  const noChange = /^\s*CHANGED:.*\b(nothing|no (?:visible )?change|unchanged)\b/im.test(txt);
  return open > 0 && landed === 0 && noChange;
}

function buildContract(repo, fixes, brief) {
  return [
    `GOAL: Apply exactly these fixes to the site in ${repo}. Change nothing else.`,
    '',
    'TOP 3 FIXES (apply verbatim):',
    fixes,
    '',
    ...(brief ? [`BUSINESS BRIEF: ${brief}`, ''] : []),
    'NO-GO LINES:',
    '- Never touch git history. Never push. Never deploy.',
    '- Never change payment or auth code.',
    '',
    'End your run with exactly this final line:',
    RESULT_LAW,
  ].join('\n');
}

function polish(c, a, api) {
  const maxRounds = Math.max(1, Math.min(Number(a.maxRounds) || 3, MAX_ROUNDS_CAP));
  const budgetMin = Number(a.budgetMin) || DEFAULT_BUDGET_MIN;
  const profile = a.profile === 'full' ? 'full' : 'fast';
  const started = Date.now();
  const id = api.newId('polish');
  const overBudget = () => Date.now() - started > budgetMin * 60000;
  const log = [`polish: ${a.url} -> ${a.repo} (${profile}, max ${maxRounds} round(s), budget ${budgetMin} min) id ${id}`];
  let lastVerdict = '';

  const stop = (reason) => { log.push(`POLISH DONE: ${reason}`); return log.join('\n'); };

  for (let round = 1; round <= maxRounds; round++) {
    if (overBudget()) return stop(`no progress: budget of ${budgetMin} min exceeded before round ${round}`);

    const review = api.review(a.url, a.brief);
    api.saveStep(id, `round ${round} review\n${review}`);
    lastVerdict = verdictLine(review);
    log.push(`round ${round} review — ${lastVerdict}`);
    if (isShip(review)) return stop(`SHIP after ${round} round(s)`);

    const fixes = topFixes(review);
    if (!fixes) return stop('no progress: review verdict has no extractable TOP 3 FIXES');

    let run;
    try { run = api.runContract(a.repo, profile, buildContract(a.repo, fixes, a.brief)); }
    catch (e) { return stop(`runner failed: ${e.message}`); }
    api.saveStep(id, `round ${round} runner\n${run && run.output != null ? run.output : JSON.stringify(run)}`);
    const verdict = String((run && run.verdict) || 'NO VERDICT').trim();
    log.push(`round ${round} runner — ${verdict}`);
    if (/NO-GO|NO VERDICT/i.test(verdict)) return stop(`runner failed: ${verdict}`);
    if (overBudget()) return stop(`no progress: budget of ${budgetMin} min exceeded after round ${round} runner`);

    const delta = api.delta(a.url);
    api.saveStep(id, `round ${round} delta\n${delta}`);
    lastVerdict = verdictLine(delta);
    log.push(`round ${round} delta — ${lastVerdict}`);
    if (isShip(delta)) return stop(`SHIP after ${round} round(s)`);
    if (stalled(delta)) return stop('no progress: delta shows no change, all fixes still fully open');
  }

  return stop(`max rounds reached (verdict ${lastVerdict})`);
}

module.exports = { polish, topFixes };
