/** Real browser/API acceptance; no route mocks or fabricated run state. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ROOT} from '../lib/compile.mjs';
const require=createRequire(path.resolve(ROOT,'../../package.json'));
const {chromium}=require('@playwright/test');
const out=path.join(ROOT,'artifacts','ui');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:960},deviceScaleFactor:1});
const page=await context.newPage();const errors=[];const checks=[];
page.on('pageerror',e=>errors.push(e.message));
const get=()=>page.evaluate(async()=>{const r=await fetch('/api/competition/state');if(!r.ok)throw new Error('state HTTP '+r.status);return r.json();});
try {
  const response=await page.goto('http://127.0.0.1:18480/competition/avalanche',{waitUntil:'networkidle'});
  assert.equal(response.status(),200);await page.locator('[data-testid="competition-workbench"]').waitFor();
  checks.push('Competition page renders independently');
  await page.screenshot({path:path.join(out,'01-overview.png'),fullPage:false});
  for(const [action,field] of [['research','market'],['backtest','backtest'],['policy','policy'],['execute','execution'],['attack','attack'],['review','review']]) {
    if(!(await get())[field]) {
      const button=page.locator(`[data-action="${action}"]`).first();
      await button.scrollIntoViewIfNeeded();
      const pending=page.waitForResponse(r=>r.url().endsWith('/api/competition/'+action)&&r.request().method()==='POST',{timeout:120000});
      await button.click();const result=await pending;const body=await result.json();
      assert.equal(result.status(),200,`${action}: ${body.error||''}`);
      assert.ok(body[field],`${field} missing from actual API response`);
    }
    await page.waitForTimeout(400);
    await page.screenshot({path:path.join(out,`${action}.png`),fullPage:true});
    checks.push(`${action}: actual browser click -> actual API -> persisted result`);
  }
  const state=await get();
  assert.equal(state.publicBroadcastPerformed,false);
  assert.equal(state.execution.chainId,31337);
  assert.equal(state.execution.evidenceVerified,true);
  assert.equal(state.backtest.lifecycle,'completed');
  assert.ok(state.backtest.trades.length>0);
  assert.equal(state.backtest.checks.strictlyLaterFills,true);
  assert.equal(state.review.nodes[1].status,'awaiting_model_configuration');
  checks.push('Historical replay uses later-bar fills; local execution evidence matches; unrun LLM is labelled');
  const denied=await fetch('http://127.0.0.1:18417/state');assert.equal(denied.status,401);
  const crossOrigin=await fetch('http://127.0.0.1:18480/api/competition/research',{method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json','x-nerya-competition':'avalanche'},body:'{}'});assert.equal(crossOrigin.status,403);
  const missingIntent=await fetch('http://127.0.0.1:18480/api/competition/research',{method:'POST',headers:{origin:'http://127.0.0.1:18480','content-type':'application/json'},body:'{}'});assert.equal(missingIntent.status,403);
  checks.push('Missing backend token, foreign Origin and absent intent header are rejected');
  await page.locator('[data-panel="evidence"]').click();await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:path.join(out,'evidence.png'),fullPage:true});
  const exported=await page.evaluate(async()=>{const r=await fetch('/api/competition/bundle');return r.json();});
  fs.writeFileSync(path.join(out,'evidence-bundle.json'),JSON.stringify(exported,null,2));
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'acceptance.json'),JSON.stringify({status:'passed',runId:state.runId,checks,browserErrors:errors,
    market:{source:state.market.source,closedBars:state.market.closedBars,start:state.market.start,end:state.market.end},
    metrics:state.backtest.metrics,execution:state.execution,attack:state.attack,publicBroadcastPerformed:false},null,2));
  console.log(JSON.stringify({status:'passed',checks,marketBars:state.market.closedBars,trades:state.backtest.trades.length,returnPct:state.backtest.metrics.total_return_pct,
    benchmarkPct:state.backtest.metrics.benchmark_buy_hold_return_pct,execution:state.execution,attack:state.attack},null,2));
}finally{await context.close();await browser.close();}
