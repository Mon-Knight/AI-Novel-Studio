import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALLOW_ELEVATED_ENV,
  assertUnelevatedWindowsHost,
  isElevatedWindowsToken,
} from './host-integrity.ts';

const medium =
  '"Group Name","Type","SID","Attributes"\n' +
  '"Mandatory Label\\Medium Mandatory Level","Label","S-1-16-8192",""\n' +
  '"BUILTIN\\Administrators","Alias","S-1-5-32-544","Group used for deny only"\n';
const high =
  '"Group Name","Type","SID","Attributes"\n' +
  '"Mandatory Label\\High Mandatory Level","Label","S-1-16-12288",""\n' +
  '"BUILTIN\\Administrators","Alias","S-1-5-32-544","Mandatory group, Enabled group, Group owner"\n';

test('medium integrity tokens are accepted and high/system tokens are detected', () => {
  assert.equal(isElevatedWindowsToken(medium), false);
  assert.equal(isElevatedWindowsToken(high), true);
  assert.equal(isElevatedWindowsToken('"System Mandatory Level","Label","S-1-16-16384",""'), true);
  assert.equal(isElevatedWindowsToken('"Custom","Label","S-1-16-122880",""'), false);
});

test('an elevated Windows terminal fails fast with actionable guidance', () => {
  assert.doesNotThrow(() => assertUnelevatedWindowsHost({}, 'win32', () => medium));
  assert.throws(
    () => assertUnelevatedWindowsHost({}, 'win32', () => high),
    /non-elevated \(medium integrity\) terminal[\s\S]*WebView2 Runtime 150\+/u,
  );
});

test('the explicit bypass and non-Windows hosts skip the check without reading the token', () => {
  let reads = 0;
  const count = () => {
    reads += 1;
    return high;
  };
  assert.doesNotThrow(() =>
    assertUnelevatedWindowsHost({ [ALLOW_ELEVATED_ENV]: '1' }, 'win32', count),
  );
  assert.doesNotThrow(() => assertUnelevatedWindowsHost({}, 'linux', count));
  assert.equal(reads, 0);
  assert.throws(() => assertUnelevatedWindowsHost({ [ALLOW_ELEVATED_ENV]: 'yes' }, 'win32', count));
});

test('an unreadable token fails closed instead of assuming a safe host', () => {
  assert.throws(
    () =>
      assertUnelevatedWindowsHost({}, 'win32', () => {
        throw new Error('whoami unavailable');
      }),
    /Could not determine the Windows integrity level/u,
  );
});
