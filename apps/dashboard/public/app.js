const state = { summary: null, requests: [], evaluations: [], detail: null, block: null, tab: 'analysis', artifact: null, filter: '', model: '', mode: '', status: '', images: '' };
const app = document.getElementById('app');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const fmt = value => Number(value ?? 0).toLocaleString();
const ms = value => value == null ? '—' : `${Math.round(value)} ms`;
async function api(path) { const response = await fetch(`/api${path}`); if (!response.ok) throw new Error(`${response.status} ${response.statusText}`); return response.json(); }
function route() { return location.hash.slice(1) || '/'; }
function head(kicker, title, description, action = '') { return `<div class="page-head"><div><div class="eyebrow">${esc(kicker)}</div><h1>${esc(title)}</h1>${description ? `<p>${esc(description)}</p>` : ''}</div>${action}</div>`; }
function metric(label, value, note) { return `<div class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value">${esc(value)}</div><div class="metric-note">${esc(note)}</div></div>`; }
function chart(rows, key, label) {
  const values = rows.slice(0, 24).reverse().map(row => Number(row[key] || 0));
  if (!values.length || values.every(value => value === 0)) return `<div class="empty"><strong>No ${esc(label.toLowerCase())} yet</strong>Measurements appear after requests complete.</div>`;
  const max = Math.max(...values, 1);
  const bars = values.map((value, index) => `<rect x="${12 + index * (776 / values.length)}" y="${152 - value / max * 126}" width="${Math.max(3, 776 / values.length - 5)}" height="${Math.max(1, value / max * 126)}" rx="2"/>`).join('');
  return `<div class="chart"><div class="chart-title">${esc(label)} <span>LAST ${values.length} REQUESTS</span></div><svg viewBox="0 0 800 164" role="img" aria-label="${esc(label)} for recent requests"><line x1="0" y1="153" x2="800" y2="153" stroke="#3b4b57"/><g fill="#f2b75d">${bars}</g></svg></div>`;
}
function requestTable(rows) {
  if (!rows.length) return '<div class="empty"><strong>No requests yet</strong>Start the proxy, run an agent task, then inspect the first request here.</div>';
  return `<table><thead><tr><th>Request</th><th>Time</th><th>Model</th><th>Mode</th><th>Input tokens</th><th>Images</th><th>Cost est.</th><th>Latency</th><th>Status</th></tr></thead><tbody>${rows.map(r => `<tr><td class="mono"><a href="#/requests/${esc(r.id)}">${esc(r.id.slice(0,8))}</a></td><td>${esc(r.timestamp)}</td><td>${esc(r.model || '—')}</td><td><span class="badge">${esc(r.mode)}</span></td><td class="mono">${r.final_tokens == null ? '—' : fmt(r.final_tokens)}</td><td class="mono">${fmt(r.image_count)}</td><td class="mono">${r.final_estimated_cost == null ? '—' : '$'+Number(r.final_estimated_cost).toFixed(4)}</td><td class="mono">${ms(r.duration_ms)}</td><td><span class="badge ${r.status >= 400 ? 'bad' : r.status ? 'ok' : ''}">${esc(r.status ?? 'pending')}</span></td></tr>`).join('')}</tbody></table>`;
}
function overview() {
  const s = state.summary || { requests: 0, final_tokens: 0, output_tokens: 0, average_duration_ms: 0 };
  app.innerHTML = head('Live observability', 'Context, under a microscope.', 'Every request, decision, and upstream result in one local view.', '<a class="button" href="#/requests">Explore requests →</a>') +
    `<div class="metrics">${metric('Requests',fmt(s.requests),'Recorded locally')}${metric('Actual input tokens',s.requests === 0 ? '0' : s.final_tokens == null ? '—' : fmt(s.final_tokens),'Provider reported where available')}${metric('Output tokens',s.requests === 0 ? '0' : s.output_tokens == null ? '—' : fmt(s.output_tokens),'Provider reported where available')}${metric('Average latency',s.requests === 0 ? '0 ms' : ms(s.average_duration_ms),'End to end')}</div>` +
    `<section class="section cards-two"><div class="panel">${chart(state.requests,'final_tokens','Input tokens')}</div><div class="panel">${chart(state.requests,'duration_ms','Latency')}</div></section>` +
    `<section class="section cards-two"><div class="panel">${chart(state.requests,'final_estimated_cost','Cost estimate')}</div><div class="panel">${chart(state.requests,'image_count','Image pages')}</div></section>` +
    `<section class="section"><div class="section-head"><h2>Recent requests</h2><a href="#/requests">VIEW ALL →</a></div><div class="panel">${requestTable(state.requests.slice(0,8))}</div></section>` +
    `<section class="section cards-two"><div class="panel info-card"><h3>Measure before optimizing</h3><p>Image conversion is experimental. Token estimates and actual provider usage are kept separate. Cost savings remain unavailable until a baseline and pricing are verified.</p></div><div class="panel info-card"><h3>Trace the transformation</h3><p>Open a request to see context blocks, strategy decisions, events, the sanitized payload, and any generated images. Source artifacts appear only when capture is enabled.</p></div></section>`;
}
function explorer() {
  const rows = state.requests.filter(r => `${r.id} ${r.model} ${r.mode} ${r.status}`.toLowerCase().includes(state.filter.toLowerCase()) &&
    (!state.model || r.model === state.model) && (!state.mode || r.mode === state.mode) &&
    (!state.status || (state.status === 'errors' ? r.status >= 400 : r.status < 400)) &&
    (!state.images || (state.images === 'yes' ? r.image_count > 0 : r.image_count === 0)));
  const models = [...new Set(state.requests.map(r => r.model).filter(Boolean))].sort();
  app.innerHTML = head('Request explorer', 'Request ledger.', 'Filter live traffic by ID, model, mode, or status.') +
    `<div class="filters"><input id="filter" type="search" placeholder="Search requests" value="${esc(state.filter)}" aria-label="Search requests"><select id="model-filter" aria-label="Filter model"><option value="">All models</option>${models.map(model => `<option value="${esc(model)}" ${state.model===model?'selected':''}>${esc(model)}</option>`).join('')}</select><select id="mode-filter" aria-label="Filter mode"><option value="">All modes</option>${['passthrough','text','image','adaptive'].map(mode => `<option value="${mode}" ${state.mode===mode?'selected':''}>${mode}</option>`).join('')}</select><select id="status-filter" aria-label="Filter status"><option value="">All statuses</option><option value="success" ${state.status==='success'?'selected':''}>Success</option><option value="errors" ${state.status==='errors'?'selected':''}>Errors</option></select><select id="image-filter" aria-label="Filter images"><option value="">Any images</option><option value="yes" ${state.images==='yes'?'selected':''}>Has images</option><option value="no" ${state.images==='no'?'selected':''}>No images</option></select></div><div class="panel">${requestTable(rows)}</div>`;
  document.getElementById('filter').addEventListener('input', event => { state.filter = event.target.value; explorer(); document.getElementById('filter').focus(); });
  for (const [id,key] of [['model-filter','model'],['mode-filter','mode'],['status-filter','status'],['image-filter','images']]) document.getElementById(id).addEventListener('change', event => { state[key] = event.target.value; explorer(); });
}
function details(id) {
  const data = state.detail;
  if (!data || data.request.id !== id) { app.innerHTML = head('Request inspector','Loading request…',''); return; }
  const { request:r, blocks, events, images } = data;
  const current = blocks.find(b => b.id === state.block) || blocks[0];
  const blockImages = images.filter(i => i.context_block_id === current?.id);
  const selected = current?.id;
  const tabs = ['analysis','original','compressed','image','payload','events'];
  let content = '';
  if (state.tab === 'analysis') content = current ? `<dl class="kv"><dt>Type</dt><dd>${esc(current.type)}</dd><dt>JSON path</dt><dd>${esc(current.path)}</dd><dt>Size</dt><dd>${fmt(current.size_bytes)} bytes</dd><dt>Text tokens</dt><dd>~${fmt(current.estimated_tokens)} · ESTIMATED</dd><dt>Risk</dt><dd>${esc(current.risk)}</dd><dt>Strategy</dt><dd>${esc(current.strategy)}</dd><dt>Decision</dt><dd>${esc(current.reason)}</dd><dt>Sensitive</dt><dd>${current.sensitive ? 'Yes · content withheld' : 'No pattern detected'}</dd></dl>` : '<p>No inspectable text blocks were found.</p>';
  if (state.tab === 'original' || state.tab === 'compressed') content = state.artifact === null ? '<p>Safe source is unavailable. In-memory inspection is bounded and clears on restart; enable redacted disk capture for longer retention.</p>' : `<pre>${esc(state.artifact)}</pre>`;
  if (state.tab === 'image') content = blockImages.length ? blockImages.map((image,index) => `<div class="image-page"><p>Page ${index+1} · ${esc(image.width)} × ${esc(image.height)} · ${fmt(image.file_size)} bytes · ~${fmt(image.estimated_image_tokens)} image tokens (ESTIMATED) · ${ms(image.render_time_ms)}</p><a class="button" target="_blank" rel="noopener" href="/api/requests/${esc(id)}/images/${esc(image.image_id)}">Open full size ↗</a><p><img class="image-preview" alt="Rendered context page ${index+1}" src="/api/requests/${esc(id)}/images/${esc(image.image_id)}"></p></div>`).join('') : '<p>No image was generated for this block.</p>';
  if (state.tab === 'payload') content = `<div class="notice">Sanitized payload representation. Credentials and embedded image bytes are omitted. In passthrough mode, upstream receives the original request bytes.</div><p><button class="button" id="copy-payload">Copy sanitized payload</button></p><pre>${esc(JSON.stringify(JSON.parse(r.final_payload_json || '{}'), null, 2))}</pre>`;
  if (state.tab === 'events') content = `<div class="event-list">${events.map(e => `<details class="event"><summary><span>${esc(e.timestamp)}</span><span>${esc(e.stage)}</span><span>${esc(e.status)} ${e.duration_ms == null ? '' : ms(e.duration_ms)}</span></summary><pre>${esc(JSON.stringify(JSON.parse(e.metadata_json || '{}'),null,2))}</pre></details>`).join('')}</div>`;
  app.innerHTML = head(`Request ${r.id.slice(0,8)}`, 'Request inspector.', `${r.model || 'Unknown model'} · ${r.endpoint} · ${r.status ?? 'pending'} · ${ms(r.duration_ms)}`, `<button class="button" id="copy-id">Copy ID</button> <button class="button" id="download">Download diagnostic</button>`) +
    `<div class="metrics">${metric('Input size',`${fmt(r.input_size)} B`,'Wire request')}${metric('Input tokens',r.final_tokens == null ? '—' : fmt(r.final_tokens),r.token_source || 'Unavailable')}${metric('Original count',r.original_tokens == null ? '—' : fmt(r.original_tokens),'ESTIMATED counterfactual')}${metric('Cache read',r.cache_read_tokens == null ? '—' : fmt(r.cache_read_tokens),'ACTUAL when reported')}${metric('Output size',`${fmt(r.output_size)} B`,'Wire response')}${metric('Output tokens',r.output_tokens == null ? '—' : fmt(r.output_tokens),'ACTUAL when reported')}${metric('Cost',r.final_estimated_cost == null ? '—' : '$'+Number(r.final_estimated_cost).toFixed(4),'ESTIMATED · configured pricing')}${metric('Latency',ms(r.duration_ms),'End to end')}</div>` +
    `<section class="section inspector-grid"><div class="panel block-list">${blocks.map(b => `<button data-block="${esc(b.id)}" class="${selected === b.id ? 'active' : ''}">${esc(b.type)}<small>${esc(b.id)} · ${fmt(b.size_bytes)} bytes</small></button>`).join('') || '<p class="muted">No blocks</p>'}</div><div class="panel detail"><h2>${esc(current?.type || 'Request')}</h2><p>${esc(current?.path || 'No text blocks')}</p><div class="detail-tabs">${tabs.map(tab => `<button data-tab="${tab}" class="${state.tab === tab ? 'active' : ''}">${tab}</button>`).join('')}</div>${content}</div></section>`;
  document.querySelectorAll('[data-block]').forEach(button => button.addEventListener('click', () => { state.block = button.dataset.block; state.tab = 'analysis'; state.artifact = null; details(id); }));
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', async () => { state.tab = button.dataset.tab; state.artifact = null; if ((state.tab === 'original' || state.tab === 'compressed') && selected) { try { const response = await fetch(`/api/requests/${id}/blocks/${selected}/${state.tab}`); if (response.ok) state.artifact = await response.text(); } catch {} } details(id); }));
  document.getElementById('download').addEventListener('click', () => { const link = document.createElement('a'); link.href = `/api/requests/${id}/diagnostic.tar.gz`; link.download = `request-${id}.tar.gz`; link.click(); });
  document.getElementById('copy-id').addEventListener('click', () => navigator.clipboard.writeText(id));
  document.getElementById('copy-payload')?.addEventListener('click', () => navigator.clipboard.writeText(JSON.stringify(JSON.parse(r.final_payload_json || '{}'), null, 2)));
}
function benchmarks() {
  const modes = ['passthrough','text','image','adaptive'];
  const tasks = [...new Set(state.evaluations.map(row => row.benchmark))];
  app.innerHTML = head('Evaluation', 'Benchmarks.', 'Real task runs across the four modes. One run is not a reliability claim.') +
    (tasks.length ? tasks.map(task => {
      const rows = modes.map(mode => state.evaluations.find(row => row.benchmark === task && row.mode === mode));
      const line = (name, get) => `<tr><th>${esc(name)}</th>${rows.map(row => `<td class="mono">${row ? esc(get(row)) : '—'}</td>`).join('')}</tr>`;
      return `<section class="section"><div class="section-head"><h2>${esc(task)}</h2></div><div class="panel"><table><thead><tr><th>Metric</th>${modes.map(mode => `<th>${esc(mode)}</th>`).join('')}</tr></thead><tbody>${line('Answer correct',r=>r.correctness === 1 ? 'YES' : 'NO')}${line('Tool-call correct',r=>r.tool_call_correct === 1 ? 'YES' : 'NO')}${line('Input tokens',r=>r.final_tokens == null ? '—' : fmt(r.final_tokens))}${line('Output tokens',r=>r.output_tokens == null ? '—' : fmt(r.output_tokens))}${line('Latency',r=>ms(r.duration_ms))}${line('Cost estimate',r=>r.final_estimated_cost == null ? '—' : '$'+Number(r.final_estimated_cost).toFixed(4))}</tbody></table></div></section>`;
    }).join('') : '<div class="panel empty"><strong>No benchmark runs</strong>Run the CLI benchmark with an exact model ID and API key. No numbers are fabricated.</div>');
}
function settings() { app.innerHTML = head('Configuration','Settings.','Local configuration is read from visionctx.config.yaml at startup.') + `<div class="panel info-card"><h3>Privacy defaults</h3><p>Request and response bodies are not persisted. Redacted source capture is opt-in. The dashboard listens on loopback only.</p></div>`; }
async function render() {
  const path = route();
  document.querySelectorAll('[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === (path.startsWith('/requests/') ? '/requests' : path)));
  document.getElementById('breadcrumb').textContent = path.toUpperCase();
  try {
    if (path.startsWith('/requests/')) { const id = path.split('/')[2]; state.detail = await api(`/requests/${id}`); state.block = state.detail.blocks[0]?.id || null; state.tab = 'analysis'; state.artifact = null; details(id); return; }
    [state.summary, state.requests] = await Promise.all([api('/summary'), api('/requests')]);
    if (path === '/benchmarks') state.evaluations = await api('/benchmarks');
    if (path === '/requests') explorer(); else if (path === '/benchmarks') benchmarks(); else if (path === '/settings') settings(); else overview();
  } catch (error) { app.innerHTML = head('Connection error','Dashboard unavailable.', String(error)); }
}
window.addEventListener('hashchange', render);
render();
setInterval(() => { if (!route().startsWith('/requests/')) render(); }, 3000);
