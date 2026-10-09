from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
blocked=[]
for folder in ['apps/api/tradequest','apps/web/components']:
 for p in (root/folder).rglob('*'):
  if p.suffix not in ('.py','.ts','.tsx'):continue
  if re.search(r'OrderSend\s*\(|mt5\.order_send|/v1/bridge|from \.services import|from \.risk import',p.read_text()):blocked.append(str(p.relative_to(root)))
if blocked:raise SystemExit('Broker/journal dependency detected: '+str(blocked))
print('PASS: standalone simulation, no broker execution or journal dependency')
