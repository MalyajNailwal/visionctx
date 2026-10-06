const state = { summary: null, requests: [], detail: null, block: null, tab: 'analysis', artifact: null, filter: '' };
const app = document.getElementById('app');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const fmt = value => Number(value ?? 0).toLocaleString();
const ms = value => value == null ? '—' : `${Math.round(value)} ms`;
async function api(path) { const response = await fetch(`/api${path}`); if (!response.ok) throw new Error(`${response.status} ${response.statusText}`); return response.json(); }
function route() { return location.hash.slice(1) || '/'; }
function head(kicker, title, description, action = '') { return `<div class="page-head"><div><div class="eyebrow">${esc(kicker)}</div><h1>${esc(title)}</h1>${description ? `<p>${esc(description)}</p>` : ''}</div>${action}</div>`; }
function metric(label, value, note) { return `<div class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-note">${esc(note)}</div></div>`; }
function requestTable(rows) {
  if (!rows.length) return '<div class="empty"><strong>No requests yet</strong>Start the proxy, run an agent task, then inspect the first request here.</div>';
  return `<table><thead><tr><th>Request</th><th>Time</th><th>Model</th><th>Mode</th><th>Input tokens</th><th>Latency</th><th>Status</th></tr></thead><tbody>${rows.map(r => `<tr><td class="mono"><a href="#/requests/${esc(r.id)}">${esc(r.id.slice(0,8))}</a></td><td>${esc(r.timestamp)}</td><td>${esc(r.model || '—')}</td><td><span class="badge">${esc(r.mode)}</span></td><td class="mono">${r.final_tokens == null ? '—' : fmt(r.final_tokens)}</td><td class="mono">${ms(r.duration_ms)}</td><td><span class="badge ${r.status >= 400 ? 'bad' : r.status ? 'ok' : ''}">${esc(r.status ?? 'pending')}</span></td></tr>`).join('')}</tbody></table>`;
}
function overview() {
  const s = state.summary || { requests: 0, final_tokens: 0, output_tokens: 0, average_duration_ms: 0 };
  app.innerHTML = head('Live observability', 'Context, under a microscope.', 'Every request, decision, and upstream result in one local view.', '<a class="button" href="#/requests">Explore requests →</a>') +
    `<div class="metrics">${metric('Requests',fmt(s.requests),'Recorded locally')}${metric('Actual input tokens',fmt(s.final_tokens),'Provider reported where available')}${metric('Output tokens',fmt(s.output_tokens),'Provider reported where available')}${metric('Average latency',ms(s.average_duration_ms),'End to end')}</div>` +
    `<section class="section"><div class="section-head"><h2>Recent requests</h2><a href="#/requests">VIEW ALL →</a></div><div class="panel">${requestTable(state.requests.slice(0,8))}</div></section>` +
    `<section class="section cards-two"><div class="panel info-card"><h3>Measure before optimizing</h3><p>Image conversion is experimental. Token estimates and actual provider usage are kept separate. Cost savings remain unavailable until a baseline and pricing are verified.</p></div><div class="panel info-card"><h3>Trace the transformation</h3><p>Open a request to see context blocks, strategy decisions, events, the sanitized payload, and any generated images. Source artifacts appear only when capture is enabled.</p></div></section>`;
}
function explorer() {
  const rows = state.requests.filter(r => `${r.id} ${r.model} ${r.mode} ${r.status}`.toLowerCase().includes(state.filter.toLowerCase()));
  app.innerHTML = head('Request explorer', 'Request ledger.', 'Filter live traffic by ID, model, mode, or status.') +
    `<div class="filters"><input id="filter" type="search" placeholder="Search requests" value="${esc(state.filter)}" aria-label="Search requests"></div><div class="panel">${requestTable(rows)}</div>`;
  document.getElementById('filter').addEventListener('input', event => { state.filter = event.target.value; explorer(); document.getElementById('filter').focus(); });
}
function details(id) {
  const data = state.detail;
  if (!data || data.request.id !== id) { app.innerHTML = head('Request inspector','Loading request…',''); return; }
  const { request:r, blocks, events, images } = data;
  const current = blocks.find(b => b.id === state.block) || blocks[0];
  const image = images.find(i => i.context_block_id === current?.id);
  const selected = current?.id;
  const tabs = ['analysis','original','compressed','image','payload','events'];
  let content = '';
  if (state.tab === 'analysis') content = current ? `<dl class="kv"><dt>Type</dt><dd>${esc(current.type)}</dd><dt>JSON path</dt><dd>${esc(current.path)}</dd><dt>Size</dt><dd>${fmt(current.size_bytes)} bytes</dd><dt>Text tokens</dt><dd>~${fmt(current.estimated_tokens)} · ESTIMATED</dd><dt>Risk</dt><dd>${esc(current.risk)}</dd><dt>Strategy</dt><dd>${esc(current.strategy)}</dd><dt>Decision</dt><dd>${esc(current.reason)}</dd><dt>Sensitive</dt><dd>${current.sensitive ? 'Yes · content withheld' : 'No pattern detected'}</dd></dl>` : '<p>No inspectable text blocks were found.</p>';
  if (state.tab === 'original' || state.tab === 'compressed') content = state.artifact === null ? '<p>Artifact was not captured. Enable redacted content capture in the local configuration for future requests.</p>' : `<pre>${esc(state.artifact)}</pre>`;
  if (state.tab === 'image') content = image ? `<p>Image ${esc(image.width)} × ${esc(image.height)} · ${fmt(image.file_size)} bytes · ~${fmt(image.estimated_image_tokens)} image tokens (ESTIMATED) · ${ms(image.render_time_ms)}</p><a class="button" target="_blank" rel="noopener" href="/api/requests/${esc(id)}/images/${esc(image.image_id)}">Open full size ↗</a><p><img class="image-preview" alt="Rendered context block" src="/api/requests/${esc(id)}/images/${esc(image.image_id)}"></p>` : '<p>No image was generated for this block.</p>';
  if (state.tab === 'payload') content = `<div class="notice">Sanitized payload representation. Credentials and embedded image bytes are omitted. In passthrough mode, upstream receives the original request bytes.</div><p><button class="button" id="copy-payload">Copy sanitized payload</button></p><pre>${esc(JSON.stringify(JSON.parse(r.final_payload_json || '{}'), null, 2))}</pre>`;
  if (state.tab === 'events') content = `<div class="event-list">${events.map(e => `<div class="event"><span>${esc(e.timestamp)}</span><span>${esc(e.stage)}</span><span>${esc(e.status)}</span></div>`).join('')}</div>`;
  app.innerHTML = head(`Request ${r.id.slice(0,8)}`, 'Request inspector.', `${r.model || 'Unknown model'} · ${r.endpoint} · ${r.status ?? 'pending'} · ${ms(r.duration_ms)}`, `<button class="button" id="download">Download diagnostic</button>`) +
    `<div class="metrics">${metric('Input size',`${fmt(r.input_size)} B`,'Wire request')}${metric('Output size',`${fmt(r.output_size)} B`,'Wire response')}${metric('Input tokens',r.final_tokens == null ? '—' : fmt(r.final_tokens),r.token_source || 'Unavailable')}${metric('Cache read',r.cache_read_tokens == null ? '—' : fmt(r.cache_read_tokens),'ACTUAL when reported')}</div>` +
    `<section class="section inspector-grid"><div class="panel block-list">${blocks.map(b => `<button data-block="${esc(b.id)}" class="${selected === b.id ? 'active' : ''}">${esc(b.type)}<small>${esc(b.id)} · ${fmt(b.size_bytes)} bytes</small></button>`).join('') || '<p class="muted">No blocks</p>'}</div><div class="panel detail"><h2>${esc(current?.type || 'Request')}</h2><p>${esc(current?.path || 'No text blocks')}</p><div class="detail-tabs">${tabs.map(tab => `<button data-tab="${tab}" class="${state.tab === tab ? 'active' : ''}">${tab}</button>`).join('')}</div>${content}</div></section>`;
  document.querySelectorAll('[data-block]').forEach(button => button.addEventListener('click', () => { state.block = button.dataset.block; state.tab = 'analysis'; state.artifact = null; details(id); }));
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', async () => { state.tab = button.dataset.tab; state.artifact = null; if ((state.tab === 'original' || state.tab === 'compressed') && selected) { try { const response = await fetch(`/api/requests/${id}/blocks/${selected}/${state.tab}`); if (response.ok) state.artifact = await response.text(); } catch {} } details(id); }));
  document.getElementById('download').addEventListener('click', async () => { const data = await api(`/requests/${id}/diagnostic`); const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'}); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `request-${id}-diagnostic.json`; link.click(); URL.revokeObjectURL(link.href); });
  document.getElementById('copy-payload')?.addEventListener('click', () => navigator.clipboard.writeText(JSON.stringify(JSON.parse(r.final_payload_json || '{}'), null, 2)));
}
function benchmarks() { app.innerHTML = head('Evaluation', 'Benchmarks.', 'Accuracy and cost comparisons will appear only after real benchmark runs.') + '<div class="panel empty"><strong>No benchmark runs</strong>Use the benchmark harness when available. No performance results are inferred from token estimates.</div>'; }
function settings() { app.innerHTML = head('Configuration','Settings.','Local configuration is read from visionctx.config.yaml at startup.') + `<div class="panel info-card"><h3>Privacy defaults</h3><p>Request and response bodies are not persisted. Redacted source capture is opt-in. The dashboard listens on loopback only.</p></div>`; }
async function render() {
  const path = route();
  document.querySelectorAll('[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === (path.startsWith('/requests/') ? '/requests' : path)));
  document.getElementById('breadcrumb').textContent = path.toUpperCase();
  try {
    if (path.startsWith('/requests/')) { const id = path.split('/')[2]; state.detail = await api(`/requests/${id}`); state.block = state.detail.blocks[0]?.id || null; state.tab = 'analysis'; state.artifact = null; details(id); return; }
    [state.summary, state.requests] = await Promise.all([api('/summary'), api('/requests')]);
    if (path === '/requests') explorer(); else if (path === '/benchmarks') benchmarks(); else if (path === '/settings') settings(); else overview();
  } catch (error) { app.innerHTML = head('Connection error','Dashboard unavailable.', String(error)); }
}
window.addEventListener('hashchange', render);
render();
setInterval(() => { if (!route().startsWith('/requests/')) render(); }, 3000);
