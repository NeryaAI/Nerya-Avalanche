"""Read-only byte-level verification against the original source snapshot."""
from pathlib import Path
import hashlib,json,os,subprocess

ROOT=Path(__file__).resolve().parents[1]
REPO=ROOT.parents[1]
provenance=json.loads((ROOT/'provenance.json').read_text())
SOURCE=Path(provenance['worktree']).parents[1]/'agent'
def git(*args,cwd=REPO):return subprocess.check_output(['git',*args],cwd=cwd)
rows=git('ls-tree','-rz',provenance['snapshot_head']).split(b'\0')
changed=[];checked=0
for row in rows:
    if not row:continue
    meta,name=row.split(b'\t',1);mode,kind,wanted=meta.split()
    if kind!=b'blob':continue
    filename=SOURCE/os.fsdecode(name)
    if not filename.exists() and not filename.is_symlink():
        changed.append({'path':os.fsdecode(name),'reason':'missing'});continue
    data=os.fsencode(os.readlink(filename)) if filename.is_symlink() else filename.read_bytes()
    actual=hashlib.sha1(f'blob {len(data)}\0'.encode()+data).hexdigest().encode()
    checked+=1
    if actual!=wanted:changed.append({'path':os.fsdecode(name),'reason':'changed_since_snapshot'})
head=git('rev-parse','HEAD',cwd=SOURCE).decode().strip()
branch=git('branch','--show-current',cwd=SOURCE).decode().strip()
services={}
for port in (18317,18380,18417,18480):
    result=subprocess.run(['lsof','-nP','-a',f'-iTCP:{port}','-sTCP:LISTEN','-Fp'],capture_output=True,text=True)
    services[str(port)]={'listening':result.returncode==0,'pids':[int(s[1:]) for s in result.stdout.splitlines() if s.startswith('p')]}
report={'status':'passed' if not changed and head==provenance['source_head'] and branch=='main' else 'attention',
        'originalBranch':branch,'originalHead':head,'sourceSnapshot':provenance['snapshot_head'],
        'sourceFilesChecked':checked,'sourceDifferences':changed,'sourceBytesUnchanged':not changed,
        'competitionBranch':git('branch','--show-current').decode().strip(),'services':services,
        'scope':'Source bytes and Git HEAD/branch checked. Service listeners checked; this is not a full production functional regression.'}
(ROOT/'artifacts').mkdir(exist_ok=True)
(ROOT/'artifacts'/'isolation-verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
raise SystemExit(0 if report['status']=='passed' else 1)
