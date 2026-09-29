'use strict';

const fs = require('fs');

const CANDIDATES = [
  process.env.MYSTIC_STUDIO_TEST_FONT,
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/Library/Fonts/Arial.ttf',
].filter(Boolean);

function findFixtureFont() {
  const font = CANDIDATES.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
  if (!font) {
    throw new Error(
      'No portable offline test font found. Set MYSTIC_STUDIO_TEST_FONT to a local TTF/OTF file.',
    );
  }
  return font;
}

module.exports = { findFixtureFont };
