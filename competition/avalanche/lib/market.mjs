import {evidenceHash} from './policy.mjs';

export function validateCandles(rows,now=Math.floor(Date.now()/1000)) {
  const today=Math.floor(now/86400)*86400;
  const closed=rows.filter(row=>row.ts<today).sort((a,b)=>a.ts-b.ts);
  const unique=[...new Map(closed.map(row=>[row.ts,row])).values()];
  if(unique.length<100) throw new Error('Need at least 100 completed daily candles; synthetic fallback is disabled');
  for(const r of unique) {
    if(!Number.isInteger(r.ts)||r.ts%86400!==0||!['open','high','low','close','volume'].every(k=>Number.isFinite(r[k])) ||
      Math.min(r.open,r.high,r.low,r.close)<=0||r.volume<0||r.high<Math.max(r.open,r.close)||r.low>Math.min(r.open,r.close))
      throw new Error('Market source returned invalid OHLCV');
  }
  if(unique.at(-1).ts<today-3*86400) throw new Error('Market history is stale by more than three days');
  const gaps=unique.slice(1).filter((row,i)=>row.ts-unique[i].ts!==86400).length;
  if(gaps) throw new Error(`Market history has ${gaps} daily gaps; refusing a misleading replay`);
  return unique;
}
export async function downloadMarket() {
  const now=new Date();const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
  const start=new Date(end.getTime()-240*86400*1000);
  const feeds=[
    {name:'Coinbase Exchange',market:'COINBASE:AVAXUSD',pair:'AVAX / USD',
      url:`https://api.exchange.coinbase.com/products/AVAX-USD/candles?granularity=86400&start=${start.toISOString()}&end=${end.toISOString()}`,
      parse:rows=>rows.map(r=>({ts:r[0],low:r[1],high:r[2],open:r[3],close:r[4],volume:r[5]}))},
    {name:'Binance public market data',market:'BINANCE:AVAXUSDT',pair:'AVAX / USDT',
      url:'https://data-api.binance.vision/api/v3/klines?symbol=AVAXUSDT&interval=1d&limit=241',
      parse:rows=>rows.map(r=>({ts:Math.floor(Number(r[0])/1000),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5])}))},
  ];
  const errors=[];
  for(const feed of feeds) {
    try {
      const response=await fetch(feed.url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(15000)});
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw=await response.json();if(!Array.isArray(raw)) throw new Error('Unexpected data schema');
      const candles=validateCandles(feed.parse(raw));
      return {source:feed.name,sourceUrl:feed.url,market:feed.market,pair:feed.pair,timeframe:'1d',
        downloadedAt:now.toISOString(),start:new Date(candles[0].ts*1000).toISOString(),
        end:new Date(candles.at(-1).ts*1000).toISOString(),closedBars: candles.length,candles,
        dataHash:evidenceHash(candles),lastClose:candles.at(-1).close,truth:'public_historical_data',
        limitations:'CEX AVAX history is a price proxy, NOT LFJ pool-level history. No fabricated candles.'};
    } catch(error) {errors.push(`${feed.name}: ${error.message}`);}
  }
  throw new Error(errors.join('; '));
}
