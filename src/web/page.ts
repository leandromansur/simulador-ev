export const PAGE_HTML = /* html */ `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Simulador EV OCPP 1.6J</title>
<style>
  :root {
    --bg:#f4f6f8; --card:#fff; --text:#1c2430; --muted:#6b7686; --line:#e1e5ea;
    --ok:#1a9d57; --warn:#d98a00; --bad:#d63b3b; --accent:#2563eb; --logbg:#0f1720; --logtext:#cfe3f5;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#10151c; --card:#18202a; --text:#e6edf5; --muted:#8a97a8; --line:#273241; --accent:#4c8dff; }
  }
  * { box-sizing:border-box; }
  body { margin:0; font:15px/1.4 system-ui,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--text); }
  header { display:flex; flex-wrap:wrap; gap:12px; align-items:center; justify-content:space-between; padding:14px 20px; background:var(--card); border-bottom:1px solid var(--line); }
  h1 { font-size:18px; margin:0; }
  .sub { color:var(--muted); font-size:13px; word-break:break-all; }
  main { max-width:1000px; margin:0 auto; padding:16px; display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; }
  .card h2 { margin:0 0 12px; font-size:13px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
  .wide { grid-column:1/-1; }
  .pill { display:inline-block; padding:3px 10px; border-radius:99px; font-size:13px; font-weight:600; color:#fff; background:var(--muted); }
  .pill.ok { background:var(--ok); } .pill.warn { background:var(--warn); } .pill.bad { background:var(--bad); }
  .status { font-size:26px; font-weight:700; margin:4px 0 8px; }
  dl { display:grid; grid-template-columns:auto 1fr; gap:6px 14px; margin:0; }
  dt { color:var(--muted); } dd { margin:0; text-align:right; font-variant-numeric:tabular-nums; }
  .bar { height:18px; background:var(--line); border-radius:9px; overflow:hidden; position:relative; margin:6px 0 4px; }
  .bar > div { height:100%; background:var(--ok); transition:width .6s; }
  .bar .target { position:absolute; top:0; bottom:0; width:2px; background:var(--text); opacity:.6; }
  .soc { font-size:30px; font-weight:700; }
  .row { display:flex; flex-wrap:wrap; gap:8px; }
  button { font:inherit; padding:9px 14px; border-radius:8px; border:1px solid var(--line); background:var(--card); color:var(--text); cursor:pointer; }
  button:hover:not(:disabled) { border-color:var(--accent); }
  button:disabled { opacity:.45; cursor:not-allowed; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  button.danger { color:var(--bad); border-color:var(--bad); }
  label { display:block; font-size:13px; color:var(--muted); margin:8px 0 3px; }
  input { font:inherit; width:100%; padding:8px; border-radius:8px; border:1px solid var(--line); background:var(--bg); color:var(--text); }
  .grid3 { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
  #msg { min-height:20px; margin-top:8px; font-size:13px; }
  #msg.err { color:var(--bad); } #msg.okm { color:var(--ok); }
  pre { margin:0; background:var(--logbg); color:var(--logtext); padding:12px; border-radius:8px; height:300px; overflow:auto; font:12px/1.5 Consolas,monospace; white-space:pre-wrap; word-break:break-all; }
  .l-ERROR { color:#ff8585; } .l-WARN { color:#ffc96b; } .l-DEBUG { color:#7f8fa3; }
</style>
</head>
<body>
<header>
  <div>
    <h1>Simulador EV · OCPP 1.6J <span id="cp" class="sub"></span></h1>
    <div class="sub" id="csms"></div>
  </div>
  <div class="row">
    <span class="pill" id="pConn">—</span>
    <span class="pill" id="pReg">—</span>
  </div>
</header>
<main>
  <section class="card">
    <h2>Conector</h2>
    <div class="status" id="status">—</div>
    <dl>
      <dt>Veículo</dt><dd id="plugged">—</dd>
      <dt>Transação</dt><dd id="txid">—</dd>
      <dt>idTag</dt><dd id="idtag">—</dd>
      <dt>Duração</dt><dd id="dur">—</dd>
    </dl>
  </section>

  <section class="card">
    <h2>Bateria</h2>
    <div class="soc"><span id="soc">0.0</span>%</div>
    <div class="bar"><div id="socbar" style="width:0"></div><span class="target" id="tgt"></span></div>
    <div class="sub" id="socinfo"></div>
  </section>

  <section class="card">
    <h2>Medições</h2>
    <dl>
      <dt>Potência</dt><dd id="pw">—</dd>
      <dt>Tensão</dt><dd id="v">—</dd>
      <dt>Corrente</dt><dd id="i">—</dd>
      <dt>Energia da sessão</dt><dd id="es">—</dd>
      <dt>Medidor (acumulado)</dt><dd id="mw">—</dd>
    </dl>
  </section>

  <section class="card">
    <h2>Ações</h2>
    <label for="tag">idTag</label>
    <input id="tag">
    <div class="row" style="margin-top:12px">
      <button class="primary" id="bStart">Conectar veículo e iniciar</button>
      <button id="bStop">Parar carga</button>
      <button id="bUnplug">Desconectar veículo</button>
    </div>
    <div class="row" style="margin-top:8px">
      <button class="danger" id="bSoft">Reset Soft</button>
      <button class="danger" id="bHard">Reset Hard</button>
    </div>
    <div id="msg"></div>
  </section>

  <section class="card">
    <h2>Parâmetros</h2>
    <div class="grid3">
      <div><label for="sPower">Potência (kW)</label><input id="sPower" type="number" step="0.1" min="0.1"></div>
      <div><label for="sInit">SOC inicial %</label><input id="sInit" type="number" min="0" max="99"></div>
      <div><label for="sTarget">SOC alvo %</label><input id="sTarget" type="number" min="1" max="100"></div>
    </div>
    <div class="row" style="margin-top:12px"><button id="bSave">Aplicar</button></div>
    <div class="sub" style="margin-top:8px">A potência vale na hora. O SOC inicial vale na próxima sessão.</div>
  </section>

  <section class="card wide">
    <h2>Logs</h2>
    <pre id="logs"></pre>
  </section>
</main>
<script>
const $ = (id) => document.getElementById(id);
let formFilled = false, last = null;

function pill(el, text, cls) { el.textContent = text; el.className = 'pill ' + cls; }
function fmt(n, d) { return Number(n).toFixed(d); }
function msg(text, err) { const m = $('msg'); m.textContent = text || ''; m.className = err ? 'err' : 'okm'; }

async function api(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Simulator': '1' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
async function act(fn, okText) {
  try { await fn(); msg(okText, false); } catch (e) { msg(e.message, true); }
  refresh();
}

function render(s) {
  last = s;
  $('cp').textContent = s.chargePointId + ' · conector ' + s.connectorId;
  $('csms').textContent = s.csmsUrl;
  pill($('pConn'), s.connected ? 'WebSocket conectado' : 'Desconectado do CSMS', s.connected ? 'ok' : 'bad');
  pill($('pReg'), s.registered ? 'Registrado' : 'Não registrado', s.registered ? 'ok' : 'warn');
  $('status').textContent = s.status;
  $('plugged').textContent = s.vehicle.plugged ? 'Conectado' : 'Desconectado';
  const t = s.transaction;
  $('txid').textContent = t ? t.transactionId : '—';
  $('idtag').textContent = t ? t.idTag : '—';
  $('dur').textContent = t ? Math.floor(t.durationSeconds / 60) + 'min ' + (t.durationSeconds % 60) + 's' : '—';
  const soc = s.vehicle.socPercent;
  $('soc').textContent = fmt(soc, 1);
  $('socbar').style.width = soc + '%';
  $('tgt').style.left = s.vehicle.targetSoc + '%';
  $('socinfo').textContent = 'Alvo ' + s.vehicle.targetSoc + '% · bateria ' + s.vehicle.batteryKwh + ' kWh';
  $('pw').textContent = fmt(s.electrical.powerKw, 1) + ' kW';
  $('v').textContent = fmt(s.electrical.voltage, 1) + ' V';
  $('i').textContent = fmt(s.electrical.currentA, 1) + ' A';
  $('es').textContent = t ? fmt(t.sessionEnergyKwh, 2) + ' kWh' : '—';
  $('mw').textContent = fmt(s.electrical.meterWh / 1000, 3) + ' kWh';
  $('bStart').disabled = !(s.registered && s.status === 'Available');
  $('bStop').disabled = !t;
  $('bUnplug').disabled = !t;
  if (!formFilled) {
    $('tag').value = s.settings.idTag;
    $('sPower').value = s.settings.maxPowerKw;
    $('sInit').value = s.vehicle.initialSoc;
    $('sTarget').value = s.vehicle.targetSoc;
    formFilled = true;
  }
}

async function refresh() {
  try { render(await (await fetch('/api/state')).json()); }
  catch { pill($('pConn'), 'Interface sem resposta', 'bad'); }
}
async function refreshLogs() {
  try {
    const { lines } = await (await fetch('/api/logs')).json();
    const box = $('logs'), stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 20;
    box.textContent = '';
    for (const l of lines) {
      const span = document.createElement('span');
      const m = l.match(/^\\[[^\\]]*\\] \\[[^\\]]*\\] (\\w+)/);
      if (m) span.className = 'l-' + m[1];
      span.textContent = l + '\\n';
      box.appendChild(span);
    }
    if (stick) box.scrollTop = box.scrollHeight;
  } catch {}
}

$('bStart').onclick = () => act(() => api('/api/start', { idTag: $('tag').value.trim() }), 'Sessão iniciada');
$('bStop').onclick = () => act(() => api('/api/stop'), 'Carga encerrada');
$('bUnplug').onclick = () => act(() => api('/api/unplug'), 'Veículo desconectado');
$('bSoft').onclick = () => confirm('Reset Soft?') && act(() => api('/api/reset', { type: 'Soft' }), 'Reset Soft executado');
$('bHard').onclick = () => confirm('Reset Hard (reconecta o WebSocket)?') && act(() => api('/api/reset', { type: 'Hard' }), 'Reset Hard executado');
$('bSave').onclick = () => act(() => api('/api/settings', {
  maxPowerKw: $('sPower').value, initialSoc: $('sInit').value, targetSoc: $('sTarget').value,
}), 'Parâmetros aplicados');

refresh(); refreshLogs();
setInterval(refresh, 1000);
setInterval(refreshLogs, 2000);
</script>
</body>
</html>`;
