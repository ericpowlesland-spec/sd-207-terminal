/* ── State ──────────────────────────────────────────────────────── */
let projects = [];
let openBugs = [];
let ws = null;
let currentProject = null;
let currentBug = null;

/* ── Init ───────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  connectWS();
  refreshAll();
});

/* ── Sidebar (mobile) ───────────────────────────────────────────── */
function toggleSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('sidebar-overlay');
  const isOpen   = sidebar.classList.contains('open');
  if (isOpen) {
    closeSidebar();
  } else {
    sidebar.classList.add('open');
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

async function refreshAll() {
  await Promise.all([loadProjects(), loadBugs()]);
}

/* ── WebSocket ──────────────────────────────────────────────────── */
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => setWsStatus('connected');
  ws.onclose = () => { setWsStatus('disconnected'); setTimeout(connectWS, 3000); };
  ws.onerror = () => setWsStatus('disconnected');

  ws.onmessage = ({ data }) => {
    try {
      const msg = JSON.parse(data);
      handleWsMessage(msg);
    } catch (e) {}
  };
}

function setWsStatus(state) {
  const dot = document.getElementById('ws-status-dot');
  const txt = document.getElementById('ws-status-text');
  dot.className = 'status-dot ' + state;
  txt.textContent = state === 'connected' ? 'Live' : state === 'disconnected' ? 'Reconnecting...' : 'Connecting...';
}

function handleWsMessage(msg) {
  switch (msg.type) {
    case 'project_created':
    case 'project_updated': {
      const idx = projects.findIndex(p => p.id === msg.payload.id);
      if (idx >= 0) projects[idx] = msg.payload;
      else projects.unshift(msg.payload);
      renderProjects();
      updateStats();
      if (currentProject && currentProject.id === msg.payload.id) {
        currentProject = msg.payload;
        renderModalContent(msg.payload);
      }
      break;
    }
    case 'project_deleted': {
      projects = projects.filter(p => p.id !== msg.payload.id);
      renderProjects();
      updateStats();
      break;
    }
    case 'bug_flagged': {
      const bug = msg.payload;
      openBugs.unshift(bug);
      updateBugBadge();
      renderBugQueue();
      showToast('Bug Flagged', `New ${bug.severity} bug: ${bug.affected_area}`, 'flag');
      const alertStrip = document.getElementById('live-alerts');
      alertStrip.classList.remove('hidden');
      alertStrip.textContent = `ALERT: New ${bug.severity.toUpperCase()} bug flagged — ${bug.affected_area}`;
      setTimeout(() => alertStrip.classList.add('hidden'), 8000);
      break;
    }
    case 'bug_updated': {
      const idx = openBugs.findIndex(b => b.id === msg.payload.id);
      if (idx >= 0) openBugs[idx] = msg.payload;
      if (currentBug && currentBug.id === msg.payload.id) {
        currentBug = msg.payload;
        renderBugModal(msg.payload);
      }
      renderBugQueue();
      break;
    }
    case 'analysis_started': {
      showToast('Claude Analyzing', 'Generating bug fix suggestion...', 'info');
      if (currentBug && currentBug.id === msg.payload.bug_id) {
        const box = document.getElementById('analysis-result');
        if (box) box.innerHTML = `<div class="analyzing-spinner"><div class="spinner"></div> Claude is analyzing this bug...</div>`;
      }
      break;
    }
    case 'analysis_complete': {
      showToast('Analysis Ready', 'Claude has a suggested fix.', 'success');
      const idx = openBugs.findIndex(b => b.id === msg.payload.bug_id);
      if (idx >= 0) {
        openBugs[idx].claude_analysis = msg.payload.analysis;
        openBugs[idx].claude_analyzed_at = new Date().toISOString();
      }
      if (currentBug && currentBug.id === msg.payload.bug_id) {
        currentBug.claude_analysis = msg.payload.analysis;
        renderAnalysisBox(msg.payload.analysis);
      }
      break;
    }
    case 'analysis_error': {
      showToast('Analysis Failed', msg.payload.error, 'error');
      break;
    }
  }
}

/* ── Data loading ───────────────────────────────────────────────── */
async function loadProjects() {
  try {
    const r = await fetch('/api/projects');
    projects = await r.json();
    renderProjects();
    updateStats();
  } catch (e) {
    showToast('Error', 'Failed to load projects', 'error');
  }
}

async function loadBugs() {
  try {
    const r = await fetch('/api/bugs');
    openBugs = await r.json();
    updateBugBadge();
    renderBugQueue();
  } catch (e) {}
}

/* ── Stats ──────────────────────────────────────────────────────── */
function updateStats() {
  document.getElementById('stat-total').textContent = projects.length;
  document.getElementById('stat-active').textContent = projects.filter(p => p.status === 'active').length;
  const avgHealth = projects.length
    ? Math.round(projects.reduce((s, p) => s + p.health, 0) / projects.length)
    : 0;
  document.getElementById('stat-avg-health').textContent = avgHealth + '%';
  document.getElementById('stat-open-bugs').textContent = projects.reduce((s, p) => s + p.bugs.filter(b => b.status === 'open').length, 0);
  document.getElementById('project-count-label').textContent = `${projects.length} project${projects.length !== 1 ? 's' : ''}`;
}

function updateBugBadge() {
  const badge = document.getElementById('bug-count-badge');
  if (openBugs.length > 0) {
    badge.textContent = openBugs.length;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

/* ── Project Grid ───────────────────────────────────────────────── */
function renderProjects() {
  const grid = document.getElementById('project-grid');
  if (projects.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--text-muted)">No projects yet. <button class="btn btn-primary btn-sm" onclick="switchView('add-project')">Add your first project</button></div>`;
    return;
  }
  grid.innerHTML = projects.map(renderProjectCard).join('');
}

function renderProjectCard(p) {
  const bugsOpen = p.bugs.filter(b => b.status === 'open');
  const criticalCount = bugsOpen.filter(b => b.severity === 'critical').length;
  const highCount = bugsOpen.filter(b => b.severity === 'high').length;
  const mediumCount = bugsOpen.filter(b => b.severity === 'medium').length;

  const total = p.components.length;
  const built = p.components.filter(c => c.status === 'complete').length;
  const inProg = p.components.filter(c => c.status === 'in_progress').length;
  const pct = total > 0 ? Math.round(((built + inProg * 0.5) / total) * 100) : 100;

  const cardClass = criticalCount > 0 ? 'has-critical' : highCount > 0 ? 'has-high' : '';
  const healthColor = p.health >= 80 ? '#00d68f' : p.health >= 60 ? '#f5a623' : p.health >= 40 ? '#f77c3d' : '#f24e4e';
  const r = 26;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ * (1 - p.health / 100);

  const flagsHtml = [
    criticalCount > 0 ? `<span class="flag flag-red">&#9873; ${criticalCount} Critical</span>` : '',
    highCount > 0     ? `<span class="flag flag-orange">&#9873; ${highCount} High</span>` : '',
    mediumCount > 0   ? `<span class="flag flag-yellow">&#9873; ${mediumCount} Medium</span>` : ''
  ].filter(Boolean).join('');

  const crmCount = p.components.filter(c => c.type === 'crm').length;
  const webCount = p.components.filter(c => c.type === 'website').length;
  const crmBuilt = p.components.filter(c => c.type === 'crm' && c.status === 'complete').length;
  const webBuilt = p.components.filter(c => c.type === 'website' && c.status === 'complete').length;

  const metaItems = [];
  if (crmCount > 0) metaItems.push(`<span class="meta-item">&#9670; ${crmBuilt}/${crmCount} CRMs</span>`);
  if (webCount > 0) metaItems.push(`<span class="meta-item">&#9671; ${webBuilt}/${webCount} Sites</span>`);
  if (bugsOpen.length > 0) metaItems.push(`<span class="meta-item" style="color:var(--red)">&#9873; ${bugsOpen.length} bugs</span>`);

  return `
    <div class="project-card ${cardClass}" onclick="openProjectModal('${p.id}')">
      <div class="card-header">
        <div>
          <div class="card-name">${escHtml(p.name)}</div>
          <div class="card-category">${escHtml(p.category)} &bull; <span class="project-status-chip pstatus-${p.status}">${p.status.replace('_',' ')}</span></div>
        </div>
        <div class="health-ring">
          <svg width="60" height="60" viewBox="0 0 60 60">
            <circle class="health-ring-bg" cx="30" cy="30" r="${r}" />
            <circle class="health-ring-val"
              cx="30" cy="30" r="${r}"
              stroke="${healthColor}"
              stroke-dasharray="${circ}"
              stroke-dashoffset="${dashOffset}" />
          </svg>
          <div class="health-ring-text" style="color:${healthColor}">${p.health}%</div>
        </div>
      </div>
      <div class="card-desc">${escHtml(p.description || '')}</div>
      ${metaItems.length > 0 ? `<div class="card-meta">${metaItems.join('')}</div>` : ''}
      ${total > 0 ? `
        <div class="card-progress-wrap">
          <div class="card-progress-label">
            <span>Components</span>
            <span>${built}/${total} built</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>
      ` : ''}
      ${flagsHtml ? `<div class="bug-flags">${flagsHtml}</div>` : ''}
    </div>`;
}

/* ── Project Modal ──────────────────────────────────────────────── */
function openProjectModal(id) {
  currentProject = projects.find(p => p.id === id);
  if (!currentProject) return;
  document.getElementById('project-modal').classList.remove('hidden');
  renderModalContent(currentProject);
}

function closeModal() {
  document.getElementById('project-modal').classList.add('hidden');
  currentProject = null;
}

function renderModalContent(p) {
  const el = document.getElementById('modal-content');
  const bugsOpen = p.bugs.filter(b => b.status === 'open');
  const total = p.components.length;
  const built = p.components.filter(c => c.status === 'complete').length;
  const inProg = p.components.filter(c => c.status === 'in_progress').length;
  const notStarted = p.components.filter(c => c.status === 'not_started').length;

  const healthColor = p.health >= 80 ? '#00d68f' : p.health >= 60 ? '#f5a623' : p.health >= 40 ? '#f77c3d' : '#f24e4e';
  const r = 35;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ * (1 - p.health / 100);

  const grouped = groupComponents(p.components);

  el.innerHTML = `
    <div class="modal-project-header">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <div class="modal-project-name">${escHtml(p.name)}</div>
        <span class="project-status-chip pstatus-${p.status}">${p.status.replace('_',' ')}</span>
      </div>
      <div class="modal-project-sub">${escHtml(p.category)} ${p.live_url ? `&bull; <a href="${escHtml(p.live_url)}" target="_blank">Live</a>` : ''} ${p.repo_url ? `&bull; <a href="${escHtml(p.repo_url)}" target="_blank">Repo</a>` : ''}</div>
      ${p.description ? `<div style="font-size:13px;color:var(--text-muted);margin-top:8px">${escHtml(p.description)}</div>` : ''}
    </div>

    <div class="health-big">
      <div class="health-big-ring health-ring">
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle class="health-ring-bg" cx="40" cy="40" r="${r}" />
          <circle class="health-ring-val"
            cx="40" cy="40" r="${r}"
            stroke="${healthColor}"
            stroke-dasharray="${circ}"
            stroke-dashoffset="${dashOffset}" />
        </svg>
        <div class="health-ring-text" style="color:${healthColor};font-size:15px">${p.health}%</div>
      </div>
      <div class="health-detail">
        <div class="health-score-label" style="color:${healthColor}">Health Score: ${p.health}%</div>
        <div class="health-breakdown">
          <span style="color:var(--green)">&#10003; ${built} built</span> &bull;
          <span style="color:var(--yellow)">&#9679; ${inProg} in progress</span> &bull;
          <span style="color:var(--text-dim)">&#9675; ${notStarted} not started</span><br>
          <span style="color:var(--red)">&#9873; ${bugsOpen.length} open bug${bugsOpen.length !== 1 ? 's' : ''}</span>
          ${bugsOpen.filter(b => b.severity === 'critical').length > 0 ? `&bull; <span style="color:var(--red);font-weight:700">${bugsOpen.filter(b => b.severity === 'critical').length} CRITICAL</span>` : ''}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <select onchange="updateProjectField('${p.id}','status',this.value)" style="background:var(--bg4);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:4px;font-size:12px">
          ${['active','in_progress','paused','complete'].map(s => `<option value="${s}" ${p.status===s?'selected':''}>${s.replace('_',' ')}</option>`).join('')}
        </select>
        <button class="btn btn-danger btn-sm" onclick="deleteProject('${p.id}')">Delete</button>
      </div>
    </div>

    ${total > 0 ? `
      <div class="modal-section">
        <div class="modal-section-title">Components (${total} total)</div>
        <div class="comp-summary">
          <span class="comp-summary-item"><span class="comp-status-dot status-complete"></span> ${built} Complete</span>
          <span class="comp-summary-item"><span class="comp-status-dot status-in_progress"></span> ${inProg} In Progress</span>
          <span class="comp-summary-item"><span class="comp-status-dot status-not_started"></span> ${notStarted} Not Started</span>
        </div>
        ${Object.entries(grouped).map(([type, comps]) => `
          <div class="component-group-title">${type.toUpperCase()} (${comps.length})</div>
          ${comps.map(c => `
            <div class="component-item" id="comp-${c.id}">
              <span class="comp-status-dot status-${c.status}"></span>
              <span class="comp-name">${escHtml(c.name)}</span>
              <span class="comp-type">${c.type}</span>
              <select class="comp-status-select" onchange="updateCompStatus('${c.id}','${p.id}',this.value)">
                <option value="not_started" ${c.status==='not_started'?'selected':''}>Not Started</option>
                <option value="in_progress" ${c.status==='in_progress'?'selected':''}>In Progress</option>
                <option value="complete"    ${c.status==='complete'   ?'selected':''}>Complete</option>
              </select>
            </div>
          `).join('')}
        `).join('')}
      </div>
    ` : ''}

    <div class="modal-section">
      <div class="modal-section-title">Add Component</div>
      <div class="add-comp-form">
        <input type="text" id="new-comp-name" placeholder="Component name" />
        <select id="new-comp-type">
          <option value="crm">CRM</option>
          <option value="website">Website</option>
          <option value="feature">Feature</option>
          <option value="integration">Integration</option>
          <option value="backend">Backend</option>
          <option value="frontend">Frontend</option>
          <option value="api">API</option>
          <option value="mobile">Mobile</option>
          <option value="other">Other</option>
        </select>
        <select id="new-comp-status">
          <option value="not_started">Not Started</option>
          <option value="in_progress">In Progress</option>
          <option value="complete">Complete</option>
        </select>
        <button class="btn btn-primary btn-sm" onclick="addComponent('${p.id}')">Add</button>
      </div>
    </div>

    ${bugsOpen.length > 0 ? `
      <div class="modal-section">
        <div class="modal-section-title">Open Bugs (${bugsOpen.length})</div>
        ${bugsOpen.map(b => `
          <div class="bug-item severity-${b.severity}" onclick="openBugModal('${b.id}')">
            <div class="bug-item-header">
              <div class="bug-item-title">${escHtml(b.affected_area)}</div>
              <span class="severity-badge severity-${b.severity}">${b.severity}</span>
            </div>
            <div class="bug-item-meta">${escHtml(b.description.slice(0, 120))}${b.description.length > 120 ? '...' : ''}</div>
            <div class="bug-item-footer">
              <span class="flag flag-${b.flag_color}">&#9873; Flagged</span>
              ${b.claude_analysis ? '<span style="font-size:11px;color:var(--green)">&#10003; Claude analyzed</span>' : ''}
            </div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${p.notes && p.notes.length > 0 ? `
      <div class="modal-section">
        <div class="modal-section-title">Notes</div>
        ${p.notes.map(n => `
          <div style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:10px 12px;margin-bottom:8px;font-size:13px;line-height:1.6">
            ${escHtml(n.content)}
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${new Date(n.created_at).toLocaleString()}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <div class="modal-section">
      <div class="modal-section-title">Add Note</div>
      <div style="display:flex;gap:8px">
        <textarea id="new-note-text" rows="2" style="flex:1;background:var(--bg3);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:8px;font-size:13px" placeholder="Add a note..."></textarea>
        <button class="btn btn-primary btn-sm" onclick="addNote('${p.id}')">Save</button>
      </div>
    </div>
  `;
}

function groupComponents(components) {
  const groups = {};
  const order = ['crm', 'website', 'feature', 'integration', 'backend', 'frontend', 'api', 'mobile', 'other'];
  components.forEach(c => {
    if (!groups[c.type]) groups[c.type] = [];
    groups[c.type].push(c);
  });
  const sorted = {};
  order.forEach(t => { if (groups[t]) sorted[t] = groups[t]; });
  Object.keys(groups).forEach(t => { if (!sorted[t]) sorted[t] = groups[t]; });
  return sorted;
}

/* ── Bug Queue ──────────────────────────────────────────────────── */
function renderBugQueue() {
  const el = document.getElementById('bug-queue-list');
  if (openBugs.length === 0) {
    el.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text-muted)">No open bugs. All clear.</div>`;
    return;
  }
  el.innerHTML = openBugs.map(b => `
    <div class="bug-item severity-${b.severity}" onclick="openBugModal('${b.id}')">
      <div class="bug-item-header">
        <div>
          <div class="bug-item-title">${escHtml(b.affected_area)}</div>
          <div class="bug-item-meta">
            ${b.project_name ? `<span>${escHtml(b.project_name)}</span> &bull; ` : ''}
            ${b.reporter_name ? `Reporter: ${escHtml(b.reporter_name)}` : ''}
            &bull; ${new Date(b.created_at).toLocaleDateString()}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
          <span class="severity-badge severity-${b.severity}">${b.severity}</span>
          <span class="status-badge status-${b.status}">${b.status}</span>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:6px;line-height:1.5">
        ${escHtml(b.description.slice(0, 150))}${b.description.length > 150 ? '...' : ''}
      </div>
      <div class="bug-item-footer">
        <span class="flag flag-${b.flag_color}">&#9873; ${b.flag_color.charAt(0).toUpperCase() + b.flag_color.slice(1)} Flag</span>
        ${b.frequency ? `<span style="font-size:11px;color:var(--text-muted)">Frequency: ${b.frequency}</span>` : ''}
        ${b.browser ? `<span style="font-size:11px;color:var(--text-muted)">${escHtml(b.browser)}</span>` : ''}
        ${b.claude_analysis ? '<span style="font-size:11px;color:var(--green)">&#10003; Claude analyzed</span>' : '<span style="font-size:11px;color:var(--text-dim)">Awaiting analysis</span>'}
      </div>
    </div>
  `).join('');
}

/* ── Bug Modal ──────────────────────────────────────────────────── */
function openBugModal(id) {
  currentBug = openBugs.find(b => b.id === id);
  if (!currentBug) {
    // Try from all project bugs
    for (const p of projects) {
      const found = p.bugs.find(b => b.id === id);
      if (found) { currentBug = found; break; }
    }
  }
  if (!currentBug) return;
  document.getElementById('bug-modal').classList.remove('hidden');
  renderBugModal(currentBug);
}

function closeBugModal() {
  document.getElementById('bug-modal').classList.add('hidden');
  currentBug = null;
}

function renderBugModal(b) {
  const el = document.getElementById('bug-modal-content');

  const project = projects.find(p => p.id === b.project_id);
  const component = project ? project.components.find(c => c.id === b.component_id) : null;

  el.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:20px">
      <div style="flex:1">
        <div style="font-size:20px;font-weight:800;margin-bottom:4px">${escHtml(b.affected_area)}</div>
        <div style="font-size:12px;color:var(--text-muted)">
          ${project ? `Project: <strong>${escHtml(project.name)}</strong> &bull; ` : ''}
          Reported ${new Date(b.created_at).toLocaleString()}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
        <span class="severity-badge severity-${b.severity}">${b.severity}</span>
        <span class="status-badge status-${b.status}">${b.status}</span>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px">
      ${field('Type', b.bug_type)}
      ${field('Frequency', b.frequency)}
      ${field('Reporter', b.reporter_name + (b.reporter_email ? ` &lt;${escHtml(b.reporter_email)}&gt;` : ''))}
      ${field('Device', [b.browser, b.device].filter(Boolean).join(' / ') || 'Not specified')}
      ${component ? field('Linked Component', `<span class="comp-status-dot status-${component.status}" style="display:inline-block;margin-right:4px"></span>${escHtml(component.name)}`) : ''}
    </div>

    <div class="divider"></div>

    <div style="margin-bottom:16px">
      <div class="modal-section-title">Description</div>
      <div style="font-size:13px;line-height:1.7;white-space:pre-wrap">${escHtml(b.description)}</div>
    </div>

    ${b.steps_to_reproduce ? `
      <div style="margin-bottom:16px">
        <div class="modal-section-title">Steps to Reproduce</div>
        <div style="font-size:13px;line-height:1.7;white-space:pre-wrap">${escHtml(b.steps_to_reproduce)}</div>
      </div>` : ''}

    ${b.expected_behavior ? `
      <div style="margin-bottom:16px">
        <div class="modal-section-title">Expected vs Actual</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div style="background:rgba(0,214,143,.05);border:1px solid rgba(0,214,143,.2);border-radius:6px;padding:10px;font-size:13px;line-height:1.6">
            <strong style="color:var(--green)">Expected</strong><br>${escHtml(b.expected_behavior)}
          </div>
          <div style="background:rgba(242,78,78,.05);border:1px solid rgba(242,78,78,.2);border-radius:6px;padding:10px;font-size:13px;line-height:1.6">
            <strong style="color:var(--red)">Actual</strong><br>${escHtml(b.actual_behavior || 'Not specified')}
          </div>
        </div>
      </div>` : ''}

    <div class="divider"></div>

    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" onclick="triggerAnalysis('${b.id}')">Analyze with Claude</button>
      <select onchange="updateBugStatus('${b.id}',this.value)" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:4px;font-size:12px">
        <option value="">Change Status...</option>
        <option value="open">Open</option>
        <option value="resolved">Resolved</option>
        <option value="wontfix">Won&apos;t Fix</option>
      </select>
      ${project ? `
        <select onchange="linkComponent('${b.id}',this.value)" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:4px;font-size:12px">
          <option value="">Link to Component...</option>
          ${project.components.map(c => `<option value="${c.id}" ${b.component_id===c.id?'selected':''}>${escHtml(c.name)}</option>`).join('')}
        </select>
      ` : ''}
    </div>

    <div id="analysis-result">
      ${b.claude_analysis ? renderAnalysisHtml(b.claude_analysis, b.claude_analyzed_at) : `<div style="font-size:13px;color:var(--text-muted)">No analysis yet. Click "Analyze with Claude" to get a suggested fix.</div>`}
    </div>
  `;
}

function field(label, value) {
  if (!value) return '';
  return `<div style="background:var(--bg3);border:1px solid var(--border);border-radius:6px;padding:10px 12px">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:3px">${label}</div>
    <div style="font-size:13px">${value}</div>
  </div>`;
}

function renderAnalysisBox(text) {
  const el = document.getElementById('analysis-result');
  if (el) el.innerHTML = renderAnalysisHtml(text, new Date().toISOString());
}

function renderAnalysisHtml(text, analyzedAt) {
  const formatted = text
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:var(--bg4);padding:1px 4px;border-radius:3px;font-size:12px">$1</code>');

  return `
    <div class="analysis-box">
      <h4>&#129302; Claude&apos;s Analysis ${analyzedAt ? `<span style="font-weight:400;color:var(--text-muted)">&bull; ${new Date(analyzedAt).toLocaleString()}</span>` : ''}</h4>
      <div class="analysis-content">${formatted}</div>
    </div>`;
}

/* ── API Actions ─────────────────────────────────────────────────── */
async function updateProjectField(id, field, value) {
  await fetch(`/api/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [field]: value })
  });
}

async function deleteProject(id) {
  if (!confirm('Delete this project? This cannot be undone.')) return;
  await fetch(`/api/projects/${id}`, { method: 'DELETE' });
  closeModal();
  showToast('Deleted', 'Project removed', 'info');
}

async function updateCompStatus(compId, projectId, status) {
  await fetch(`/api/components/${compId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  });
  const dot = document.querySelector(`#comp-${compId} .comp-status-dot`);
  if (dot) dot.className = `comp-status-dot status-${status}`;
}

async function addComponent(projectId) {
  const name   = document.getElementById('new-comp-name').value.trim();
  const type   = document.getElementById('new-comp-type').value;
  const status = document.getElementById('new-comp-status').value;
  if (!name) return;
  await fetch(`/api/projects/${projectId}/components`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type, status })
  });
  document.getElementById('new-comp-name').value = '';
  showToast('Added', `Component "${name}" added`, 'success');
}

async function addNote(projectId) {
  const content = document.getElementById('new-note-text').value.trim();
  if (!content) return;
  await fetch(`/api/projects/${projectId}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  });
  document.getElementById('new-note-text').value = '';
  showToast('Saved', 'Note added', 'success');
}

async function triggerAnalysis(bugId) {
  const box = document.getElementById('analysis-result');
  if (box) box.innerHTML = `<div class="analyzing-spinner"><div class="spinner"></div> Claude is analyzing this bug...</div>`;
  try {
    await fetch(`/api/bugs/${bugId}/analyze`, { method: 'POST' });
  } catch (e) {
    showToast('Error', e.message, 'error');
  }
}

async function updateBugStatus(bugId, status) {
  if (!status) return;
  const updated = await (await fetch(`/api/bugs/${bugId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status })
  })).json();
  openBugs = openBugs.filter(b => b.id !== bugId || b.status === 'open');
  renderBugQueue();
  updateBugBadge();
  showToast('Updated', `Bug marked as ${status}`, 'success');
  if (status !== 'open') closeBugModal();
}

async function linkComponent(bugId, componentId) {
  if (!componentId) return;
  await fetch(`/api/bugs/${bugId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ component_id: componentId })
  });
  showToast('Linked', 'Bug linked to component', 'success');
}

async function submitNewProject(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  form.reset();
  switchView('dashboard');
  showToast('Created', `Project "${data.name}" added`, 'success');
}

/* ── View switching ─────────────────────────────────────────────── */
function switchView(view) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');
  document.querySelector(`[data-view="${view}"]`)?.classList.add('active');

  const titles = { dashboard: 'All Projects', bugs: 'Bug Queue', 'add-project': 'New Project' };
  document.getElementById('view-title').textContent = titles[view] || view;

  // Close sidebar on mobile after navigating
  if (window.innerWidth <= 900) closeSidebar();
}

/* ── Toast ──────────────────────────────────────────────────────── */
function showToast(title, message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<div class="toast-title">${escHtml(title)}</div><div class="toast-message">${escHtml(message)}</div>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

/* ── Utils ──────────────────────────────────────────────────────── */
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
