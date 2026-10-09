const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'gate.js'), 'utf8');
const target = 'https://www.paypal.com/checkout?x=1';

async function scenario(prepare, proceed) {
  const calls = [];
  const elements = new Map();
  let replaced = null;
  for (const id of ['#domain', '#required', '#status', '#explanation', '#retry']) {
    elements.set(id, { textContent: '', className: '', hidden: id === '#retry', disabled: false,
      addEventListener() {} });
  }
  const context = vm.createContext({
    URL, console,
    document: { querySelector: selector => elements.get(selector) },
    location: { hash: `#${target}`, replace: url => { replaced = url; } },
    chrome: { runtime: { sendMessage: async message => {
      calls.push(message.type);
      if (message.type === 'getSites') return { sites: [{ domain: 'paypal.com', required: 'off', auto: true }] };
      if (message.type === 'prepare') return prepare;
      if (message.type === 'proceed') return proceed;
      throw new Error('Unexpected message');
    } } }
  });
  vm.runInContext(source, context);
  await new Promise(resolve => setTimeout(resolve, 10));
  return { calls, replaced, retry: elements.get('#retry'), status: elements.get('#status') };
}

(async () => {
  const ready = await scenario({ warp: { state: 'off' } }, { allowed: true });
  assert.deepEqual(ready.calls, ['getSites', 'prepare', 'proceed']);
  assert.equal(ready.replaced, target);
  assert.equal(ready.retry.hidden, true);

  const mismatch = await scenario({ warp: { state: 'on' } }, { allowed: true });
  assert.deepEqual(mismatch.calls, ['getSites', 'prepare']);
  assert.equal(mismatch.replaced, null);
  assert.equal(mismatch.retry.hidden, false);

  const changedBeforeOpening = await scenario({ warp: { state: 'off' } },
    { allowed: false, warp: { state: 'on' }, required: 'off' });
  assert.equal(changedBeforeOpening.replaced, null);
  assert.equal(changedBeforeOpening.retry.hidden, false);

  console.log('Automatic opening and fail-closed paths passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
