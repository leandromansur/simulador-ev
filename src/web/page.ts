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
  header { display:flex; flex-wrap:wrap; gap:12px; align-items:center; justify-content:space-between; padding:12px 20px; background:var(--card); border-bottom:1px solid var(--line); }
  h1 { font-size:18px; margin:0; }
  .sub { color:var(--muted); font-size:13px; word-break:break-all; }
  nav { display:flex; flex-wrap:wrap; gap:4px; padding:8px 16px 0; max-width:1100px; margin:0 auto; }
  nav button { border-radius:8px 8px 0 0; border-bottom:none; }
  nav button.on { background:var(--accent); border-color:var(--accent); color:#fff; }
  main { max-width:1100px; margin:0 auto; padding:16px; }
  .tab { display:none; gap:16px; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); }
  .tab.on { display:grid; }
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
  .row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:8px; }
  button { font:inherit; padding:8px 13px; border-radius:8px; border:1px solid var(--line); background:var(--card); color:var(--text); cursor:pointer; }
  button:hover:not(:disabled) { border-color:var(--accent); }
  button:disabled { opacity:.45; cursor:not-allowed; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  button.danger { color:var(--bad); border-color:var(--bad); }
  label { display:block; font-size:13px; color:var(--muted); margin:8px 0 3px; }
  label.inline { display:inline-flex; gap:6px; align-items:center; margin:0; }
  input, select, textarea { font:inherit; width:100%; padding:7px 8px; border-radius:8px; border:1px solid var(--line); background:var(--bg); color:var(--text); }
  input[type=checkbox] { width:auto; }
  textarea { font:12px/1.4 Consolas,monospace; min-height:110px; }
  .grid2 { display:grid; grid-template-columns:repeat(2,1fr); gap:8px; }
  .grid3 { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
  .msg { min-height:20px; margin-top:8px; font-size:13px; }
  .msg.err { color:var(--bad); } .msg.okm { color:var(--ok); }
  pre { margin:0; background:var(--logbg); color:var(--logtext); padding:12px; border-radius:8px; overflow:auto; font:12px/1.5 Consolas,monospace; white-space:pre-wrap; word-break:break-all; }
  pre.logs { height:520px; } pre.small { max-height:260px; }
  .l-ERROR { color:#ff8585; } .l-WARN { color:#ffc96b; } .l-DEBUG { color:#7f8fa3; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  td, th { text-align:left; padding:4px 6px; border-bottom:1px solid var(--line); vertical-align:middle; }
  td input { padding:4px 6px; }
  .ro { color:var(--muted); }
</style>
</head>
<body>
<header>
  <div>
    <h1>Simulador EV · OCPP 1.6J <span id="cp" class="sub"></span></h1>
    <div class="sub" id="csms"></div>
  </div>
  <div class="row" style="margin:0">
    <span class="pill" id="pErr" style="display:none"></span>
    <span class="pill" id="pConn">—</span>
    <span class="pill" id="pReg">—</span>
  </div>
</header>
<nav id="tabs"></nav>
<main>

<!-- ================= PAINEL ================= -->
<div class="tab on" id="t-painel">
  <section class="card">
    <h2>Conector</h2>
    <div class="status" id="status">—</div>
    <dl>
      <dt>Veículo</dt><dd id="plugged">—</dd>
      <dt>Transação</dt><dd id="txid">—</dd>
      <dt>idTag</dt><dd id="idtag">—</dd>
      <dt>Duração</dt><dd id="dur">—</dd>
      <dt>Erro</dt><dd id="errc">—</dd>
      <dt>Disponibilidade</dt><dd id="avail">—</dd>
      <dt>Reserva</dt><dd id="resv">—</dd>
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
      <dt>Limite efetivo</dt><dd id="lim">—</dd>
      <dt>Tensão</dt><dd id="v">—</dd>
      <dt>Corrente</dt><dd id="i">—</dd>
      <dt>Energia da sessão</dt><dd id="es">—</dd>
      <dt>Medidor (acumulado)</dt><dd id="mw">—</dd>
    </dl>
  </section>

  <section class="card">
    <h2>Sessão</h2>
    <label for="tag">idTag</label>
    <input id="tag">
    <div class="row">
      <button class="primary" id="bStart">Conectar veículo e iniciar</button>
      <button id="bUnplug">Desconectar veículo</button>
    </div>
    <label for="stopReason">Parar carga (reason do StopTransaction)</label>
    <div class="row" style="margin-top:0">
      <select id="stopReason" style="width:auto">
        <option>Local</option><option>EmergencyStop</option><option>PowerLoss</option>
        <option>DeAuthorized</option><option>Reboot</option><option>Other</option>
      </select>
      <button id="bStop">Parar</button>
    </div>
    <div class="row">
      <button id="bSusEV">Pausar (EV)</button>
      <button id="bSusEVSE">Pausar (EVSE)</button>
      <button id="bResume">Retomar</button>
    </div>
    <div class="row">
      <button class="danger" id="bSoft">Reset Soft</button>
      <button class="danger" id="bHard">Reset Hard</button>
    </div>
    <div class="msg" id="msg"></div>
  </section>
</div>

<!-- ================= SIMULACAO ================= -->
<div class="tab" id="t-sim">
  <section class="card">
    <h2>Carregador</h2>
    <div class="grid2">
      <div><label>Potência máx. (kW)</label><input id="sPower" type="number" step="0.1" min="0.1"></div>
      <div><label>Tensão (V)</label><input id="sVolt" type="number" min="1"></div>
      <div><label>Fases</label><select id="sPhases"><option>1</option><option>3</option></select></div>
      <div><label>Fator de potência</label><input id="sPf" type="number" step="0.01" min="0.01" max="1"></div>
      <div><label>MeterValueSampleInterval (s)</label><input id="sMeterInt" type="number" min="0"></div>
      <div><label>idTag padrão</label><input id="sTag"></div>
    </div>
    <h2 style="margin-top:16px">Identidade (BootNotification)</h2>
    <div class="grid2">
      <div><label>Fabricante</label><input id="sVendor"></div>
      <div><label>Modelo</label><input id="sModel"></div>
      <div><label>Nº de série</label><input id="sSerial"></div>
      <div><label>Firmware</label><input id="sFw"></div>
    </div>
    <div class="sub" style="margin-top:6px">Identidade vale a partir do próximo BootNotification (Reset ou botão em Mensagens).</div>
  </section>

  <section class="card">
    <h2>Veículo</h2>
    <div class="grid3">
      <div><label>SOC inicial %</label><input id="sInit" type="number" min="0" max="99"></div>
      <div><label>SOC alvo %</label><input id="sTarget" type="number" min="1" max="100"></div>
      <div><label>Bateria (kWh)</label><input id="sBat" type="number" step="0.1" min="0.1"></div>
    </div>
    <div class="row"><button class="primary" id="bSave">Aplicar parâmetros</button></div>
    <div class="sub" style="margin-top:8px">Potência/tensão valem na hora. SOC inicial vale na próxima sessão; bateria só sem transação.</div>
    <div class="msg" id="msgSim"></div>
  </section>

  <section class="card">
    <h2>Falhas e erros (StatusNotification)</h2>
    <label>errorCode</label>
    <select id="fCode"></select>
    <div class="grid2">
      <div><label>info</label><input id="fInfo" maxlength="50"></div>
      <div><label>vendorErrorCode</label><input id="fVendor" maxlength="50"></div>
    </div>
    <div class="row">
      <label class="inline"><input type="checkbox" id="fFaulted" checked> Conector Faulted (encerra transação)</label>
    </div>
    <div class="row">
      <button class="danger" id="bFault">Injetar erro</button>
      <button id="bClearFault">Limpar erro</button>
    </div>
  </section>

  <section class="card">
    <h2>Disponibilidade local</h2>
    <div class="row">
      <button id="bInop">Tornar Inoperante</button>
      <button id="bOper">Tornar Operante</button>
    </div>
    <h2 style="margin-top:16px">Comportamento (testar o CSMS)</h2>
    <div class="row"><label class="inline"><input type="checkbox" id="bhFw"> Atualização de firmware falha</label></div>
    <div class="row"><label class="inline"><input type="checkbox" id="bhDiag"> Upload de diagnóstico falha</label></div>
    <div class="row"><label class="inline"><input type="checkbox" id="bhUnlock"> UnlockConnector falha</label></div>
    <div class="sub" style="margin-top:8px">Status atuais · Diagnóstico: <b id="stDiag">—</b> · Firmware: <b id="stFw">—</b></div>
  </section>
</div>

<!-- ================= MENSAGENS ================= -->
<div class="tab" id="t-msg">
  <section class="card">
    <h2>Charge Point → CSMS</h2>
    <div class="row">
      <button id="mBoot">BootNotification</button>
      <button id="mHb">Heartbeat</button>
      <button id="mMeter">MeterValues</button>
    </div>
    <label>Authorize / idTag</label>
    <div class="row" style="margin-top:0"><input id="mTag" style="flex:1"><button id="mAuth">Authorize</button></div>
    <label>StatusNotification</label>
    <div class="grid2">
      <select id="mStatus"></select><select id="mStErr"></select>
    </div>
    <div class="row"><button id="mStatusBtn">Enviar StatusNotification</button></div>
    <label>DataTransfer</label>
    <div class="grid3">
      <input id="dtVendor" placeholder="vendorId"><input id="dtMsg" placeholder="messageId"><input id="dtData" placeholder="data">
    </div>
    <div class="row"><button id="mDT">Enviar DataTransfer</button></div>
    <label>Notificações</label>
    <div class="grid2">
      <select id="nDiag"><option>Idle</option><option>Uploaded</option><option>UploadFailed</option><option>Uploading</option></select>
      <select id="nFw"><option>Idle</option><option>Downloaded</option><option>DownloadFailed</option><option>Downloading</option><option>InstallationFailed</option><option>Installing</option><option>Installed</option></select>
    </div>
    <div class="row">
      <button id="mDiag">DiagnosticsStatusNotification</button>
      <button id="mFw">FirmwareStatusNotification</button>
    </div>
  </section>

  <section class="card">
    <h2>Mensagem personalizada</h2>
    <label>Action</label>
    <input id="rAction" value="Heartbeat">
    <label>Payload (JSON)</label>
    <textarea id="rPayload">{}</textarea>
    <div class="row"><button class="primary" id="rSend">Enviar CALL</button></div>
    <label>Resposta</label>
    <pre class="small" id="rOut">—</pre>
    <div class="msg" id="msgCall"></div>
  </section>
</div>

<!-- ================= CONFIG OCPP ================= -->
<div class="tab" id="t-cfg">
  <section class="card wide">
    <h2>Configuração OCPP (GetConfiguration / ChangeConfiguration)</h2>
    <div class="row" style="margin-top:0">
      <label class="inline"><input type="checkbox" id="cForce"> Modo local (permite alterar chaves somente leitura e criar novas)</label>
    </div>
    <table><thead><tr><th>Chave</th><th>Valor</th><th></th></tr></thead><tbody id="cfgBody"></tbody></table>
    <div class="row">
      <input id="cNewKey" placeholder="nova chave" style="width:200px"><input id="cNewVal" placeholder="valor" style="width:200px">
      <button id="cAdd">Definir</button>
    </div>
    <div class="msg" id="msgCfg"></div>
  </section>
</div>

<!-- ================= ESTADO ================= -->
<div class="tab" id="t-state">
  <section class="card">
    <h2>Reserva</h2>
    <pre class="small" id="stResv">—</pre>
    <div class="row"><button id="clResv">Cancelar reserva</button></div>
  </section>
  <section class="card">
    <h2>Perfis de carga (SetChargingProfile)</h2>
    <pre class="small" id="stProf">—</pre>
    <div class="row"><button id="clProf">Limpar todos</button></div>
  </section>
  <section class="card">
    <h2>Lista local de autorização</h2>
    <pre class="small" id="stList">—</pre>
  </section>
  <section class="card">
    <h2>Authorization Cache</h2>
    <pre class="small" id="stCache">—</pre>
    <div class="row"><button id="clCache">Limpar cache</button></div>
  </section>
</div>

<!-- ================= CONEXAO ================= -->
<div class="tab" id="t-conn">
  <section class="card">
    <h2>Conexão com o CSMS</h2>
    <label>ChargePointId</label><input id="kId">
    <label>CSMS URL (ws:// ou wss://)</label><input id="kUrl">
    <label>Senha HTTP Basic (usuário = ChargePointId; vazio = sem senha)</label><input id="kPass" type="password" autocomplete="off">
    <div class="row"><label class="inline"><input type="checkbox" id="kAppend" checked> Anexar ChargePointId à URL</label></div>
    <div class="row"><button class="primary" id="kApply">Aplicar e reconectar</button></div>
    <div class="sub" style="margin-top:8px">URL final: <b id="kFinal">—</b></div>
    <div class="msg" id="msgConn"></div>
  </section>
</div>

<!-- ================= LOGS ================= -->
<div class="tab" id="t-logs">
  <section class="card wide">
    <h2>Logs / mensagens OCPP</h2>
    <div class="row" style="margin-top:0">
      <input id="lFilter" placeholder="filtrar (ex.: StartTransaction)" style="max-width:260px">
      <label class="inline"><input type="checkbox" id="lDebug"> DEBUG (payloads)</label>
      <label class="inline"><input type="checkbox" id="lPause"> Pausar</label>
      <button id="lCopy">Copiar</button>
    </div>
    <pre class="logs" id="logs" style="margin-top:8px"></pre>
  </section>
</div>

</main>
<script>
const $ = (id) => document.getElementById(id);
const TABS = [['painel','Painel'],['sim','Simulação'],['msg','Mensagens'],['cfg','Config OCPP'],['state','Reservas / Perfis / Listas'],['conn','Conexão'],['logs','Logs']];
const STATUSES = ['Available','Preparing','Charging','SuspendedEV','SuspendedEVSE','Finishing','Reserved','Unavailable','Faulted'];
const ERRORS = ['NoError','ConnectorLockFailure','EVCommunicationError','GroundFailure','HighTemperature','InternalError','LocalListConflict','OtherError','OverCurrentFailure','PowerMeterFailure','PowerSwitchFailure','ReaderFailure','ResetFailure','UnderVoltage','OverVoltage','WeakSignal'];
let last = null, filled = {}, cfgSig = '';

function el(tag, props, children) {
  const e = document.createElement(tag);
  Object.assign(e, props || {});
  (children || []).forEach((c) => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return e;
}
function opts(sel, list) { list.forEach((v) => sel.appendChild(el('option', { textContent: v }))); }
function pill(e, text, cls) { e.textContent = text; e.className = 'pill ' + cls; }
function fmt(n, d) { return Number(n).toFixed(d); }
function msg(id, text, err) { const m = $(id); m.textContent = text || ''; m.className = 'msg ' + (err ? 'err' : 'okm'); }

async function api(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Simulator': '1' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || j.status || ('HTTP ' + r.status));
  return j;
}
function act(fn, okText, box) {
  return async () => {
    try { await fn(); msg(box || 'msg', okText, false); } catch (e) { msg(box || 'msg', e.message, true); }
    refresh();
  };
}
/** Envia CALL ao CSMS e mostra a resposta na area de mensagens. */
function call(action, payload) {
  return async () => {
    try {
      const j = await api('/api/call', { action, payload });
      $('rOut').textContent = action + ' ->\\n' + JSON.stringify(j.response, null, 2);
      msg('msgCall', action + ' enviado', false);
    } catch (e) {
      $('rOut').textContent = action + ' ->\\nERRO: ' + e.message;
      msg('msgCall', e.message, true);
    }
    refresh();
  };
}

// ---------- abas ----------
TABS.forEach(([id, label], i) => {
  const b = el('button', { textContent: label, className: i === 0 ? 'on' : '' });
  b.onclick = () => {
    document.querySelectorAll('nav button').forEach((x) => x.classList.remove('on'));
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('on'));
    b.classList.add('on'); $('t-' + id).classList.add('on');
    if (id === 'cfg') cfgSig = '';
    if (last) render(last);
  };
  $('tabs').appendChild(b);
});
opts($('fCode'), ERRORS.slice(1));
opts($('mStatus'), STATUSES); opts($('mStErr'), ERRORS);

function render(s) {
  last = s;
  $('cp').textContent = s.chargePointId + ' · conector ' + s.connectorId;
  $('csms').textContent = s.csmsUrl;
  pill($('pConn'), s.connected ? 'WebSocket conectado' : 'Desconectado do CSMS', s.connected ? 'ok' : 'bad');
  pill($('pReg'), s.registered ? 'Registrado' : 'Não registrado', s.registered ? 'ok' : 'warn');
  const pe = $('pErr');
  if (s.errorCode !== 'NoError') { pe.style.display = ''; pill(pe, s.errorCode, 'bad'); } else pe.style.display = 'none';

  $('status').textContent = s.status;
  $('plugged').textContent = s.vehicle.plugged ? 'Conectado' : 'Desconectado';
  const t = s.transaction;
  $('txid').textContent = t ? t.transactionId : '—';
  $('idtag').textContent = t ? t.idTag : '—';
  $('dur').textContent = t ? Math.floor(t.durationSeconds / 60) + 'min ' + (t.durationSeconds % 60) + 's' : '—';
  $('errc').textContent = s.errorCode;
  $('avail').textContent = s.inoperative ? 'Inoperante' : 'Operante';
  $('resv').textContent = s.reservation ? '#' + s.reservation.reservationId + ' (' + s.reservation.idTag + ')' : '—';
  const soc = s.vehicle.socPercent;
  $('soc').textContent = fmt(soc, 1);
  $('socbar').style.width = soc + '%';
  $('tgt').style.left = s.vehicle.targetSoc + '%';
  $('socinfo').textContent = 'Alvo ' + s.vehicle.targetSoc + '% · bateria ' + s.vehicle.batteryKwh + ' kWh';
  $('pw').textContent = fmt(s.electrical.powerKw, 1) + ' kW';
  $('lim').textContent = fmt(s.effectivePowerKw, 1) + ' kW';
  $('v').textContent = fmt(s.electrical.voltage, 1) + ' V';
  $('i').textContent = fmt(s.electrical.currentA, 1) + ' A';
  $('es').textContent = t ? fmt(t.sessionEnergyKwh, 2) + ' kWh' : '—';
  $('mw').textContent = fmt(s.electrical.meterWh / 1000, 3) + ' kWh';
  const canStart = s.registered && (s.status === 'Available' || s.status === 'Reserved');
  $('bStart').disabled = !canStart;
  $('bStop').disabled = !t; $('bUnplug').disabled = !t;
  $('bSusEV').disabled = !(t && s.status === 'Charging');
  $('bSusEVSE').disabled = !(t && s.status === 'Charging');
  $('bResume').disabled = !(t && (s.status === 'SuspendedEV' || s.status === 'SuspendedEVSE'));

  if (!filled.set) {
    const x = s.settings;
    $('tag').value = x.idTag; $('sTag').value = x.idTag; $('mTag').value = x.idTag;
    $('sPower').value = x.maxPowerKw; $('sVolt').value = x.voltage; $('sPhases').value = x.phases;
    $('sPf').value = x.powerFactor; $('sBat').value = x.batteryKwh;
    $('sVendor').value = x.vendor; $('sModel').value = x.model; $('sSerial').value = x.serialNumber; $('sFw').value = x.firmwareVersion;
    $('sInit').value = s.vehicle.initialSoc; $('sTarget').value = s.vehicle.targetSoc;
    $('dtVendor').value = x.vendor;
    $('kId').value = s.chargePointId; const idSuffix = '/' + encodeURIComponent(s.chargePointId);
    $('kUrl').value = s.csmsUrl.endsWith(idSuffix) ? s.csmsUrl.slice(0, -idSuffix.length) : s.csmsUrl;
    filled.set = true;
  }
  if (document.activeElement !== $('sMeterInt')) {
    const mi = s.configuration.find((c) => c.key === 'MeterValueSampleInterval');
    if (mi) $('sMeterInt').value = mi.value;
  }
  $('kFinal').textContent = s.csmsUrl;
  $('stDiag').textContent = s.diagnosticsStatus; $('stFw').textContent = s.firmwareStatus;
  for (const [k, id] of [['firmwareFails','bhFw'],['diagnosticsFails','bhDiag'],['unlockFails','bhUnlock']]) {
    if (document.activeElement !== $(id)) $(id).checked = !!s.behavior[k];
  }
  $('stResv').textContent = s.reservation ? JSON.stringify(s.reservation, null, 2) : 'Nenhuma reserva';
  $('stProf').textContent = s.profiles.length ? JSON.stringify(s.profiles, null, 2) : 'Nenhum perfil instalado';
  $('stList').textContent = 'Versão ' + s.localList.version + ' · ' + s.localList.entries.length + ' entradas\\n' + JSON.stringify(s.localList.entries, null, 2);
  $('stCache').textContent = s.authCache.length ? s.authCache.join('\\n') : 'Vazio';
  renderConfig(s.configuration);
}

function renderConfig(list) {
  if (!$('t-cfg').classList.contains('on')) return;
  const sig = JSON.stringify(list);
  if (sig === cfgSig || $('cfgBody').contains(document.activeElement)) return;
  cfgSig = sig;
  const body = $('cfgBody'); body.textContent = '';
  list.forEach((c) => {
    const inp = el('input', { value: c.value, disabled: false });
    inp.dataset.key = c.key;
    const btn = el('button', { textContent: 'Salvar' });
    btn.onclick = act(() => api('/api/config', { key: c.key, value: inp.value, force: $('cForce').checked }), c.key + ' salvo', 'msgCfg');
    const name = el('td', { className: c.readonly ? 'ro' : '', textContent: c.key + (c.readonly ? ' (somente leitura)' : '') });
    body.appendChild(el('tr', {}, [name, el('td', {}, [inp]), el('td', {}, [btn])]));
  });
}

async function refresh() {
  try { render(await (await fetch('/api/state')).json()); }
  catch { pill($('pConn'), 'Interface sem resposta', 'bad'); }
}
let logLines = [];
function drawLogs() {
  const box = $('logs'), f = $('lFilter').value.toLowerCase(), dbg = $('lDebug').checked;
  const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 20;
  box.textContent = '';
  for (const l of logLines) {
    const m = l.match(/^\\[[^\\]]*\\] \\[[^\\]]*\\] (\\w+)/);
    if (m && m[1] === 'DEBUG' && !dbg) continue;
    if (f && l.toLowerCase().indexOf(f) < 0) continue;
    const span = document.createElement('span');
    if (m) span.className = 'l-' + m[1];
    span.textContent = l + '\\n';
    box.appendChild(span);
  }
  if (stick) box.scrollTop = box.scrollHeight;
}
async function refreshLogs() {
  if ($('lPause').checked || !$('t-logs').classList.contains('on') && logLines.length) return;
  try { logLines = (await (await fetch('/api/logs?n=600')).json()).lines; drawLogs(); } catch {}
}

// ---------- painel ----------
$('bStart').onclick = act(() => api('/api/start', { idTag: $('tag').value.trim() }), 'Sessão iniciada');
$('bStop').onclick = act(() => api('/api/stop', { reason: $('stopReason').value }), 'Carga encerrada');
$('bUnplug').onclick = act(() => api('/api/unplug'), 'Veículo desconectado');
$('bSusEV').onclick = act(() => api('/api/suspend', { by: 'EV' }), 'Pausada (SuspendedEV)');
$('bSusEVSE').onclick = act(() => api('/api/suspend', { by: 'EVSE' }), 'Pausada (SuspendedEVSE)');
$('bResume').onclick = act(() => api('/api/resume'), 'Carga retomada');
$('bSoft').onclick = () => confirm('Reset Soft?') && act(() => api('/api/reset', { type: 'Soft' }), 'Reset Soft executado')();
$('bHard').onclick = () => confirm('Reset Hard (reconecta o WebSocket)?') && act(() => api('/api/reset', { type: 'Hard' }), 'Reset Hard executado')();

// ---------- simulacao ----------
$('bSave').onclick = act(() => api('/api/settings', {
  maxPowerKw: $('sPower').value, voltage: $('sVolt').value, phases: $('sPhases').value, powerFactor: $('sPf').value,
  meterInterval: $('sMeterInt').value, idTag: $('sTag').value, initialSoc: $('sInit').value, targetSoc: $('sTarget').value,
  batteryKwh: $('sBat').value, vendor: $('sVendor').value, model: $('sModel').value, serialNumber: $('sSerial').value, firmwareVersion: $('sFw').value,
}), 'Parâmetros aplicados', 'msgSim');
$('bFault').onclick = act(() => api('/api/fault', { errorCode: $('fCode').value, faulted: $('fFaulted').checked, info: $('fInfo').value, vendorErrorCode: $('fVendor').value }), 'Erro injetado', 'msgSim');
$('bClearFault').onclick = act(() => api('/api/fault', { errorCode: 'NoError' }), 'Erro limpo', 'msgSim');
$('bInop').onclick = act(() => api('/api/availability', { type: 'Inoperative' }), 'Inoperante', 'msgSim');
$('bOper').onclick = act(() => api('/api/availability', { type: 'Operative' }), 'Operante', 'msgSim');
for (const [k, id] of [['firmwareFails','bhFw'],['diagnosticsFails','bhDiag'],['unlockFails','bhUnlock']]) {
  $(id).onchange = () => api('/api/behavior', { [k]: $(id).checked }).catch(() => {});
}

// ---------- mensagens ----------
$('mBoot').onclick = () => call('BootNotification', { chargePointVendor: $('sVendor').value, chargePointModel: $('sModel').value, chargePointSerialNumber: $('sSerial').value, firmwareVersion: $('sFw').value })();
$('mHb').onclick = () => call('Heartbeat', {})();
$('mAuth').onclick = () => call('Authorize', { idTag: $('mTag').value })();
$('mStatusBtn').onclick = () => call('StatusNotification', { connectorId: last ? last.connectorId : 1, status: $('mStatus').value, errorCode: $('mStErr').value, timestamp: new Date().toISOString() })();
$('mDT').onclick = () => {
  const p = { vendorId: $('dtVendor').value };
  if ($('dtMsg').value) p.messageId = $('dtMsg').value;
  if ($('dtData').value) p.data = $('dtData').value;
  return call('DataTransfer', p)();
};
$('mDiag').onclick = () => call('DiagnosticsStatusNotification', { status: $('nDiag').value })();
$('mFw').onclick = () => call('FirmwareStatusNotification', { status: $('nFw').value })();
$('mMeter').onclick = () => {
  if (!last) return;
  const e = last.electrical, t = last.transaction;
  const sv = (value, measurand, unit, location) => ({ value: String(value), context: 'Other', format: 'Raw', measurand, unit, location: location || 'Outlet' });
  const p = { connectorId: last.connectorId, meterValue: [{ timestamp: new Date().toISOString(), sampledValue: [
    sv(Math.round(e.meterWh), 'Energy.Active.Import.Register', 'Wh'), sv(Math.round(e.powerKw * 1000), 'Power.Active.Import', 'W'),
    sv(fmt(e.currentA, 2), 'Current.Import', 'A'), sv(fmt(e.voltage, 1), 'Voltage', 'V'), sv(fmt(last.vehicle.socPercent, 1), 'SoC', 'Percent', 'EV')] }] };
  if (t) p.transactionId = t.transactionId;
  return call('MeterValues', p)();
};
$('rSend').onclick = () => {
  let payload;
  try { payload = JSON.parse($('rPayload').value || '{}'); } catch { return msg('msgCall', 'JSON inválido', true); }
  return call($('rAction').value.trim(), payload)();
};

// ---------- config / estado / conexao ----------
$('cAdd').onclick = act(() => api('/api/config', { key: $('cNewKey').value.trim(), value: $('cNewVal').value, force: $('cForce').checked }), 'Chave definida', 'msgCfg');
$('clResv').onclick = act(() => api('/api/local-state', { clear: 'reservation' }), 'Reserva cancelada', 'msg');
$('clProf').onclick = act(() => api('/api/local-state', { clear: 'profiles' }), 'Perfis removidos', 'msg');
$('clCache').onclick = act(() => api('/api/local-state', { clear: 'cache' }), 'Cache limpo', 'msg');
$('kApply').onclick = act(async () => {
  const j = await api('/api/connection', { chargePointId: $('kId').value, csmsUrl: $('kUrl').value, password: $('kPass').value, append: $('kAppend').checked });
  $('kFinal').textContent = j.url;
}, 'Reconectando…', 'msgConn');
$('lFilter').oninput = drawLogs; $('lDebug').onchange = drawLogs;
$('lCopy').onclick = () => navigator.clipboard && navigator.clipboard.writeText($('logs').textContent);

refresh(); refreshLogs();
setInterval(refresh, 1000);
setInterval(refreshLogs, 1500);
</script>
</body>
</html>`;
