import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateCandles} from '../lib/market.mjs';
const today=20000*86400;
const candles=()=>Array.from({length:120},(_,i)=>({ts:today-(120-i)*86400,open:25,high:26,low:24,close:25,volume:10}));
test('market loader accepts only completed unique daily candles',()=>{
  const rows=[...candles(),{...candles()[0],ts:today}];
  assert.equal(validateCandles(rows,today+100).length,120);
});
test('market loader rejects insufficient, malformed, stale and gapped data',()=>{
  assert.throws(()=>validateCandles(candles().slice(0,50),today),/100/);
  const bad=candles();bad[5].close=NaN;assert.throws(()=>validateCandles(bad,today),/OHLCV/);
  const gap=candles();gap.splice(30,1);assert.throws(()=>validateCandles(gap,today),/gaps/);
  assert.throws(()=>validateCandles(candles(),today+10*86400),/stale/);
});
