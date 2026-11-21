import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { clientFailureCopy, failureCopy } from './index.js';

/** Words Dan never needs: the parts of the system, a status code, or a count. */
const internalNames = /\b(?:PI|Foundry|gateway|harness|MCP|approvals?|HTTP|agent definition|Deploy|workflow|engine|provider|token|stream|backend|server|API)\b|\d/iu;
const mayHaveHappened = 'it may already have happened, so check before you try again';

test('every failure sentence is plain, short and in the first person', () => {
  for (const [kind, copy] of Object.entries(failureCopy)) {
    for (const text of [copy.chat, copy.voice]) {
      assert.doesNotMatch(text, internalNames, `${kind}: ${text}`);
      assert.match(text, /[.]$/u, `${kind} ends in a full stop`);
    }
    assert.ok(copy.chat.length <= 150, `${kind} chat is short enough to read at a glance`);
    // Voice is one short spoken sentence.
    assert.ok(copy.voice.length <= 90, `${kind} voice is short enough to say`);
    assert.equal(copy.voice.match(/[.!?](?=\s|$)/gu)?.length, 1, `${kind} voice is one sentence`);
  }
  for (const [kind, copy] of Object.entries(clientFailureCopy)) {
    assert.doesNotMatch(copy.chat, internalNames, `${kind}: ${copy.chat}`);
    assert.match(copy.chat, /[.]$/u);
    assert.ok(copy.chat.length <= 150);
  }
});

test('only the sentences where an action may have happened tell Dan to check first, and the clean ones say nothing ran', () => {
  const warns = Object.entries({ ...failureCopy, ...clientFailureCopy })
    .filter(([, copy]) => copy.chat.includes(mayHaveHappened)).map(([kind]) => kind);
  assert.deepEqual(warns.sort(), ['cut_off', 'lost_connection', 'lost_track', 'no_reply', 'reply_too_long', 'stopped', 'took_too_long']);
  assert.match(failureCopy.cut_off_clean.chat, /nothing was done/u);
  assert.match(failureCopy.took_too_long_clean.chat, /Nothing was done/u);
});

test('the server and the web client never share a sentence under different kinds', () => {
  const sentences = [...Object.values(failureCopy), ...Object.values(clientFailureCopy)].map((copy) => copy.chat);
  assert.equal(new Set(sentences).size, sentences.length);
});

test('the iPhone says the same words as the contract where it shows the same situation', () => {
  const file = fileURLToPath(new URL(
    '../../../apps/ios/Packages/JarvisCore/Sources/JarvisCore/Resources/en.lproj/JarvisChat.strings', import.meta.url,
  ));
  const strings = new Map([...readFileSync(file, 'utf8').matchAll(/^"([^"]+)"\s*=\s*"((?:[^"\\]|\\.)*)";$/gmu)].map((match) => [match[1], match[2]]));
  // A turn the app could not finish, and a reply it lost track of, read the same on every screen.
  assert.equal(strings.get('chat.activity.errTurn'), failureCopy.cut_off.chat);
  assert.equal(strings.get('chat.activity.errTurnNotFound'), clientFailureCopy.lost_track.chat);
  // A tool that did not work is not a failed turn.
  assert.notEqual(strings.get('chat.turn.toolError'), 'Failed');
});
