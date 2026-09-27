'use strict';
// Optional frontend sources for the existing Studio review -> coding-runner loop.
// Studio itself does not install or redistribute these third-party packages.

const ASSETS = Object.freeze({
  lenis: {
    name: 'Lenis', source: 'https://github.com/darkroomengineering/lenis',
    use: 'Smooth scrolling in a website when the brief calls for it.',
    integration: 'Install lenis in the target website; use a single instance and follow its current setup docs. Coordinate its RAF with GSAP ScrollTrigger if both are used.',
    guard: 'Respect reduced-motion preferences, native anchors and keyboard navigation; do not add it to static artwork or every page by default.',
  },
  gsap: {
    name: 'GSAP', source: 'https://github.com/greensock/GSAP',
    use: 'Controlled timeline, text, or scroll-triggered animation in a website.',
    integration: 'Install gsap in the target website; register only the plugins needed and scope animations to the component lifecycle.',
    guard: 'Provide a reduced-motion state and avoid hiding essential content before JavaScript loads.',
  },
  vanta: {
    name: 'Vanta', source: 'https://github.com/tengbao/vanta',
    use: 'An optional animated background in a bounded website section.',
    integration: 'Install the chosen vanta effect and its documented three.js or p5.js dependency in the target website; initialize on the client and destroy on teardown.',
    guard: 'Use a static fallback for reduced motion or unavailable WebGL; check mobile performance, contrast and legibility.',
  },
  'react-bits': {
    name: 'React Bits', source: 'https://github.com/DavidHDev/react-bits',
    use: 'A component-level animation in an existing React website.',
    integration: 'Choose an individual component from the official installation page for the target React project; preserve the upstream license notice when required.',
    guard: 'React projects only. The MIT + Commons Clause license prohibits selling or redistributing the components themselves; do not bundle their source into Studio or a standalone component pack.',
  },
});

function ids() { return Object.keys(ASSETS); }
function select(input) {
  if (!input) return [];
  if (typeof input !== 'string') throw new Error('motion must be a comma-separated list of asset ids');
  const requested = input.split(',').map((s) => s.trim().toLowerCase());
  if (requested.some((s) => !s || !ASSETS[s])) throw new Error(`unknown motion asset — known: ${ids().join(', ')}`);
  return [...new Set(requested)].map((id) => ({ id, ...ASSETS[id] }));
}
function format(input) {
  const selected = input ? select(input) : ids().map((id) => ({ id, ...ASSETS[id] }));
  return selected.map((a) => `${a.name} (${a.id}) — ${a.use}\nSource: ${a.source}\nIntegration: ${a.integration}\nGuard: ${a.guard}`).join('\n\n');
}
module.exports = { ids, select, format };
