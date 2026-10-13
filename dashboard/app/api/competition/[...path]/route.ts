import {NextRequest,NextResponse} from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const reads=new Set(['state','bundle','fuji/artifact','fuji/wallet','fuji/execution']);
const writes=new Set(['research','backtest','policy','execute','attack','review']);

async function proxy(request:NextRequest,context:{params:{path:string[]}}) {
  if(process.env.NERYA_COMPETITION!=='avalanche'||process.env.NERYA_COMPETITION_NATIVE==='1')return NextResponse.json({error:'Use the native Agent workspace and /api/proxy instead'},{status:404});
  const host=request.headers.get('host')||'';
  if(!/^(127\.0\.0\.1|localhost):18480$/.test(host))return NextResponse.json({error:'Competition UI is loopback-only'},{status:403});
  const route=context.params.path.join('/');
  const isWrite=request.method==='POST';
  if(!(isWrite?writes:reads).has(route))return NextResponse.json({error:'Not found'},{status:404});
  if(isWrite) {
    const origin=request.headers.get('origin');
    if(origin!==`http://${host}`)return NextResponse.json({error:'Same-origin request required'},{status:403});
    if(request.headers.get('x-nerya-competition')!=='avalanche')return NextResponse.json({error:'Competition intent header required'},{status:403});
    if((request.headers.get('content-type')||'').split(';')[0]!=='application/json')return NextResponse.json({error:'JSON required'},{status:415});
  }
  const token=process.env.NERYA_COMPETITION_TOKEN;
  if(!token||token.length<32)return NextResponse.json({error:'Isolated competition service is not configured'},{status:503});
  try {
    const response=await fetch(`http://127.0.0.1:18417/${route}`,{
      method:isWrite?'POST':'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},
      ...(isWrite?{body:'{}'}:{}),cache:'no-store',signal:AbortSignal.timeout(120000),
    });
    const value=await response.json();
    return NextResponse.json(value,{status:response.status,headers:{'cache-control':'no-store'}});
  }catch{return NextResponse.json({error:'The isolated competition service is unavailable. The normal Nerya runtime was not contacted.'},{status:503});}
}
export {proxy as GET,proxy as POST};
