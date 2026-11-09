const failures = new Map([
  ['Invalid pool state', 'invalid_state'],
  ['Pool state too large', 'oversized_state'],
  ['Ambiguous Factory sandbox allocation', 'ambiguous_allocation'],
  ['Factory sandbox allocation uncertain; reconciliation required', 'uncertain_allocation'],
  ['Sandbox ownership mismatch', 'ownership_mismatch'],
  ['Sandbox workspace initialization failed', 'workspace_setup_failed'],
  ['Sandbox worker boot failed', 'worker_boot_failed'],
]);

export function safeError(error) {
  const frame = /\/([A-Za-z0-9_.-]+\.(?:m?js|ts)):(\d+):(\d+)/u.exec(error?.stack ?? '');
  return {type: error?.constructor?.name ?? 'Unknown',
    status: Number.isInteger(error?.statusCode) ? error.statusCode : null,
    code: failures.get(error?.message) ??
      (typeof error?.code === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/u.test(error.code) ? error.code : null),
    location: frame ? `${frame[1]}:${frame[2]}:${frame[3]}` : null};
}

// No environment, file contents, process arguments or provider output leave the worker.
export const workerInspection = `python -c 'import json,os,pathlib,re,stat
paths=["/files/jarvis","/files/jarvis/.mailbox-sas.next","/files/jarvis/.mailbox-sas","/files/jarvis/.worker.log","/app/worker.py"]
result={"uid":os.getuid(),"gid":os.getgid(),"paths":[]}
for name in paths:
 p=pathlib.Path(name)
 try:
  s=p.stat(); result["paths"].append({"path":name,"uid":s.st_uid,"gid":s.st_gid,"mode":oct(stat.S_IMODE(s.st_mode)),"bytes":s.st_size})
 except OSError as e: result["paths"].append({"path":name,"error":type(e).__name__})
p=pathlib.Path("/files/jarvis/.worker.log")
if p.exists():
 try:
  with p.open("rb") as f:
   f.seek(max(0,p.stat().st_size-8192)); tail=f.read(8192).decode("utf8",errors="replace")
  result["logErrorTypes"]=sorted(set(re.findall(r"\\b(?:PermissionError|FileNotFoundError|ModuleNotFoundError|RuntimeError|ValueError|ImportError|SyntaxError)\\b",tail)))
 except OSError as e: result["logReadError"]=type(e).__name__
print(json.dumps(result))'`;
