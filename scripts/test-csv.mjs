import assert from 'node:assert/strict';
import { downloadCSV } from '../src/utils/helpers.js';

let blob;
let anchor;
let clicks = 0;
URL.createObjectURL = value => { blob = value; return 'blob:test'; };
globalThis.document = {
  createElement: tag => {
    assert.equal(tag, 'a');
    anchor = { href: '', download: '', click: () => { clicks++; } };
    return anchor;
  },
};

downloadCSV([{
  reference: '123,456',
  note: 'say "hi"\r\nnext',
  formula: '=1+1',
  leadingFormula: '\t@SUM(A1:A2)',
  amount: 10.5,
}], '4peace_transactions.csv');

assert.equal(anchor.href, 'blob:test');
assert.equal(anchor.download, '4peace_transactions.csv');
assert.equal(clicks, 1);
assert.equal(await blob.text(), '"reference","note","formula","leadingFormula","amount"\r\n"123,456","say ""hi""\r\nnext","\'=1+1","\'\t@SUM(A1:A2)","10.5"');

downloadCSV([], 'empty.csv');
assert.equal(clicks, 1);
process.stdout.write('PASS CSV headers, quotes, delimiters, line breaks, formula injection, filename, and empty export.\n');
