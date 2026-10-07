#!/usr/bin/env node
/**
 * CSMS OCPP 1.6J DESCARTAVEL, apenas para testar o simulador.
 * Nao faz parte da imagem Docker nem do docker-compose. Roda no host:
 *
 *   node tools/mock-csms.js
 *
 * OCPP : ws://0.0.0.0:9000/ocpp/<ChargePointId>   (PORT)
 * Painel: http://localhost:9001                    (PANEL_PORT, somente 127.0.0.1)
 * idTag "INVALID" e recusado; qualquer outro e aceito.
 */
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 9000);
const PANEL_PORT = Number(process.env.PANEL_PORT || 9001);
const HEARTBEAT_INTERVAL = Number(process.env.HEARTBEAT_INTERVAL || 30);

const chargePoints = new Map(); // id -> { ws, status, boot, lastMeter, pending: Map }
const transactions = new Map(); // id -> { id, cp, idTag, meterStart, meterStop?, reason? }
const events = [];
let nextTx = 1000;

function log(cp, dir, text) {
  const line = `[${new Date().toISOString()}] [${cp}] ${dir} ${text}`;
  console.log(line);
  events.push(line);
  if (events.length > 300) events.shift();
}

const wss = new WebSocketServer({
  port: PORT,
  host: '0.0.0.0',
  handleProtocols: (protocols) => (protocols.has('ocpp1.6') ? 'ocpp1.6' : false),
});

wss.on('connection', (ws, req) => {
  const cpId = decodeURIComponent((req.url || '/').split('?')[0].split('/').filter(Boolean).pop() || 'UNKNOWN');
  const cp = { ws, id: cpId, status: {}, boot: null, lastMeter: null, pending: new Map() };
  chargePoints.set(cpId, cp);
  log(cpId, '==', `conectado (subprotocol=${ws.protocol})`);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return log(cpId, '!!', 'frame invalido'); }
    const [type, id, a, b] = msg;
    if (type === 2) return handleCall(cp, id, a, b || {});
    const p = cp.pending.get(id);
    if (!p) return;
    cp.pending.delete(id);
    if (type === 3) { log(cpId, '<-', `${p.action}.conf ${JSON.stringify(a)}`); p.resolve(a); }
    else { log(cpId, '<-', `${p.action} CALLERROR ${a} ${b}`); p.reject(new Error(`${a}: ${b}`)); }
  });

  ws.on('close', () => {
    if (chargePoints.get(cpId) === cp) chargePoints.delete(cpId);
    log(cpId, '==', 'desconectado');
  });
});

function handleCall(cp, id, action, p) {
  log(cp.id, '<-', `${action} ${JSON.stringify(p)}`);
  const now = new Date().toISOString();
  let res = {};
  switch (action) {
    case 'BootNotification':
      cp.boot = p;
      res = { status: 'Accepted', currentTime: now, interval: HEARTBEAT_INTERVAL };
      break;
    case 'Heartbeat':
      res = { currentTime: now };
      break;
    case 'StatusNotification':
      cp.status[p.connectorId] = p.status;
      break;
    case 'Authorize':
      res = { idTagInfo: { status: p.idTag === 'INVALID' ? 'Invalid' : 'Accepted' } };
      break;
    case 'StartTransaction': {
      const ok = p.idTag !== 'INVALID';
      const tx = { id: ++nextTx, cp: cp.id, idTag: p.idTag, meterStart: p.meterStart, startedAt: p.timestamp };
      if (ok) transactions.set(tx.id, tx);
      res = { transactionId: tx.id, idTagInfo: { status: ok ? 'Accepted' : 'Invalid' } };
      break;
    }
    case 'StopTransaction': {
      const tx = transactions.get(p.transactionId);
      if (tx) Object.assign(tx, { meterStop: p.meterStop, reason: p.reason, stoppedAt: p.timestamp });
      res = { idTagInfo: { status: 'Accepted' } };
      break;
    }
    case 'MeterValues': {
      const sv = (p.meterValue?.[0]?.sampledValue) || [];
      const get = (m) => sv.find((s) => s.measurand === m);
      cp.lastMeter = {
        transactionId: p.transactionId,
        timestamp: p.meterValue?.[0]?.timestamp,
        energyWh: get('Energy.Active.Import.Register')?.value,
        powerW: get('Power.Active.Import')?.value,
        currentA: get('Current.Import')?.value,
        voltageV: get('Voltage')?.value,
        soc: get('SoC')?.value,
      };
      break;
    }
    default:
      log(cp.id, '->', `${action} CALLERROR NotImplemented`);
      return cp.ws.send(JSON.stringify([4, id, 'NotImplemented', `${action} nao suportada`, {}]));
  }
  log(cp.id, '->', `${action}.conf ${JSON.stringify(res)}`);
  cp.ws.send(JSON.stringify([3, id, res]));
}

function callChargePoint(cpId, action, payload) {
  const cp = chargePoints.get(cpId);
  if (!cp) return Promise.reject(new Error(`Charge Point ${cpId} nao conectado`));
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cp.pending.delete(id); reject(new Error('timeout')); }, 15000);
    cp.pending.set(id, {
      action,
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    log(cpId, '->', `${action} ${JSON.stringify(payload)}`);
    cp.ws.send(JSON.stringify([2, id, action, payload]));
  });
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>CSMS de teste</title>
<style>body{font:14px system-ui;margin:20px;max-width:900px}pre{background:#0f1720;color:#cfe3f5;padding:10px;height:320px;overflow:auto;font-size:12px}
button{padding:6px 10px;margin:2px}.card{border:1px solid #ccc;border-radius:8px;padding:12px;margin:10px 0}</style>
<h2>CSMS de teste (descartavel)</h2><div id="cps"></div><h3>Logs</h3><pre id="log"></pre>
<script>
async function call(path, body){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-panel':'1'},body:JSON.stringify(body)});
 const j=await r.json();alert(JSON.stringify(j));}
async function tick(){const s=await (await fetch('/state')).json();
 const el=document.getElementById('cps');
 el.innerHTML=s.chargePoints.length?'':'<i>Nenhum Charge Point conectado</i>';
 for(const c of s.chargePoints){const d=document.createElement('div');d.className='card';
  const tx=s.transactions.filter(t=>t.cp===c.id&&!t.stoppedAt).map(t=>t.id)[0];
  const m=c.lastMeter;
  d.innerHTML='<b>'+c.id+'</b> &middot; '+JSON.stringify(c.status)+' &middot; transacao ativa: '+(tx||'-')+
   (m?'<br>Energia '+m.energyWh+' Wh &middot; '+m.powerW+' W &middot; '+m.currentA+' A &middot; '+m.voltageV+' V &middot; SoC '+m.soc+'%':'')+
   '<br><input value="REMOTE001" id="t-'+c.id+'"> <button data-a="start">RemoteStart</button> <button data-a="stop">RemoteStop</button> '+
   '<button data-a="soft">Reset Soft</button> <button data-a="hard">Reset Hard</button>';
  d.querySelectorAll('button').forEach(b=>b.onclick=()=>{const a=b.dataset.a;
   if(a==='start')call('/remote-start',{cp:c.id,idTag:document.getElementById('t-'+c.id).value});
   if(a==='stop')call('/remote-stop',{cp:c.id,transactionId:tx});
   if(a==='soft'||a==='hard')call('/reset',{cp:c.id,type:a==='soft'?'Soft':'Hard'});});
  el.appendChild(d);}
 const pre=document.getElementById('log'),stick=pre.scrollTop+pre.clientHeight>=pre.scrollHeight-20;
 pre.textContent=s.events.join('\\n');if(stick)pre.scrollTop=pre.scrollHeight;}
setInterval(tick,1500);tick();
</script>`;

http.createServer((req, res) => {
  const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PAGE); }
  if (req.method === 'GET' && req.url === '/state') {
    return json(200, {
      chargePoints: [...chargePoints.values()].map((c) => ({ id: c.id, status: c.status, boot: c.boot, lastMeter: c.lastMeter })),
      transactions: [...transactions.values()],
      events: events.slice(-150),
    });
  }
  if (req.method === 'POST' && req.headers['x-panel'] === '1') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      try {
        const b = JSON.parse(raw || '{}');
        let result;
        if (req.url === '/remote-start') result = await callChargePoint(b.cp, 'RemoteStartTransaction', { idTag: b.idTag, connectorId: 1 });
        else if (req.url === '/remote-stop') result = await callChargePoint(b.cp, 'RemoteStopTransaction', { transactionId: b.transactionId });
        else if (req.url === '/reset') result = await callChargePoint(b.cp, 'Reset', { type: b.type });
        else return json(404, { error: 'nao encontrado' });
        json(200, result);
      } catch (e) { json(400, { error: e.message }); }
    });
    return;
  }
  json(404, { error: 'nao encontrado' });
}).listen(PANEL_PORT, '127.0.0.1');

console.log(`CSMS de teste: ws://0.0.0.0:${PORT}/ocpp/<id>  |  painel: http://localhost:${PANEL_PORT}`);
