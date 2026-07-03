/**
 * Pure-JS JSON database — no native binaries required.
 * Data persists to command_center.json in the project directory.
 */
const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'command_center.json');

// ─── In-memory store ──────────────────────────────────────────────────────────
let store = { projects: [], components: [], bugs: [], notes: [] };

function load() {
  if (fs.existsSync(DB_PATH)) {
    try { store = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
    catch (e) { console.error('DB read error:', e.message); }
  }
  // Ensure all collections exist
  store.projects   = store.projects   || [];
  store.components = store.components || [];
  store.bugs       = store.bugs       || [];
  store.notes      = store.notes      || [];
}

function save() {
  fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2));
}

load();

function now() { return new Date().toISOString(); }

// ─── Projects ────────────────────────────────────────────────────────────────

function getAllProjects() {
  return store.projects
    .slice()
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map(p => enrichProject(p));
}

function getProjectById(id) {
  const p = store.projects.find(p => p.id === id);
  return p ? enrichProject(p) : null;
}

function enrichProject(p) {
  const components = store.components.filter(c => c.project_id === p.id)
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  const bugs  = store.bugs.filter(b => b.project_id === p.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const notes = store.notes.filter(n => n.project_id === p.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const health = computeHealth(components, bugs);
  return { ...p, components, bugs, notes, health };
}

function computeHealth(components, bugs) {
  let score = 100;

  if (components.length > 0) {
    const built  = components.filter(c => c.status === 'complete').length;
    const inProg = components.filter(c => c.status === 'in_progress').length;
    const completionRate = (built + inProg * 0.5) / components.length;
    score -= Math.round((1 - completionRate) * 30);
  }

  const openBugs    = bugs.filter(b => b.status === 'open');
  const criticalBugs = openBugs.filter(b => b.severity === 'critical');
  const highBugs     = openBugs.filter(b => b.severity === 'high');
  const restBugs     = openBugs.length - criticalBugs.length - highBugs.length;

  score -= Math.min(criticalBugs.length * 15, 30);
  score -= Math.min(highBugs.length * 8, 20);
  score -= Math.min(restBugs * 3, 15);

  return Math.max(0, Math.min(100, score));
}

function createProject(data) {
  const p = {
    id:          uuidv4(),
    name:        data.name,
    description: data.description || '',
    category:    data.category    || 'general',
    repo_url:    data.repo_url    || '',
    live_url:    data.live_url    || '',
    status:      data.status      || 'active',
    created_at:  now(),
    updated_at:  now(),
  };
  store.projects.push(p);
  save();
  return getProjectById(p.id);
}

function updateProject(id, data) {
  const idx = store.projects.findIndex(p => p.id === id);
  if (idx < 0) return null;
  const allowed = ['name','description','category','repo_url','live_url','status'];
  allowed.forEach(k => { if (data[k] !== undefined) store.projects[idx][k] = data[k]; });
  store.projects[idx].updated_at = now();
  save();
  return getProjectById(id);
}

function deleteProject(id) {
  store.projects   = store.projects.filter(p => p.id !== id);
  store.components = store.components.filter(c => c.project_id !== id);
  store.bugs       = store.bugs.filter(b => b.project_id !== id);
  store.notes      = store.notes.filter(n => n.project_id !== id);
  save();
}

// ─── Components ──────────────────────────────────────────────────────────────

function createComponent(projectId, data) {
  const c = {
    id:          uuidv4(),
    project_id:  projectId,
    name:        data.name,
    type:        data.type        || 'other',
    description: data.description || '',
    status:      data.status      || 'not_started',
    url:         data.url         || '',
    notes:       data.notes       || '',
    created_at:  now(),
    updated_at:  now(),
  };
  store.components.push(c);
  _touchProject(projectId);
  save();
  return c;
}

function updateComponent(id, data) {
  const idx = store.components.findIndex(c => c.id === id);
  if (idx < 0) return null;
  const allowed = ['name','type','description','status','url','notes'];
  allowed.forEach(k => { if (data[k] !== undefined) store.components[idx][k] = data[k]; });
  store.components[idx].updated_at = now();
  _touchProject(store.components[idx].project_id);
  save();
  return store.components[idx];
}

function deleteComponent(id) {
  store.components = store.components.filter(c => c.id !== id);
  save();
}

// ─── Bug Reports ─────────────────────────────────────────────────────────────

function createBugReport(data) {
  const sev = data.severity || 'medium';
  const flagColor = sev === 'critical' ? 'red' : sev === 'high' ? 'orange' : 'yellow';
  const b = {
    id:                  uuidv4(),
    project_id:          data.project_id          || null,
    component_id:        data.component_id        || null,
    reporter_name:       data.reporter_name       || 'Anonymous',
    reporter_email:      data.reporter_email      || '',
    affected_area:       data.affected_area,
    bug_type:            data.bug_type            || 'functional',
    description:         data.description,
    steps_to_reproduce:  data.steps_to_reproduce  || '',
    expected_behavior:   data.expected_behavior   || '',
    actual_behavior:     data.actual_behavior     || '',
    severity:            sev,
    frequency:           data.frequency           || 'sometimes',
    browser:             data.browser             || '',
    device:              data.device              || '',
    screenshot_url:      data.screenshot_url      || '',
    status:              'open',
    flag_color:          flagColor,
    claude_analysis:     null,
    claude_analyzed_at:  null,
    created_at:          now(),
    updated_at:          now(),
  };
  store.bugs.push(b);
  if (b.project_id) _touchProject(b.project_id);
  save();
  return b;
}

function getBugById(id) {
  return store.bugs.find(b => b.id === id) || null;
}

function updateBugReport(id, data) {
  const idx = store.bugs.findIndex(b => b.id === id);
  if (idx < 0) return null;
  const allowed = ['status','flag_color','severity','claude_analysis','claude_analyzed_at','component_id'];
  allowed.forEach(k => { if (data[k] !== undefined) store.bugs[idx][k] = data[k]; });
  store.bugs[idx].updated_at = now();
  if (store.bugs[idx].project_id) _touchProject(store.bugs[idx].project_id);
  save();
  return store.bugs[idx];
}

function getAllOpenBugs() {
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  return store.bugs
    .filter(b => b.status === 'open')
    .map(b => {
      const p = store.projects.find(p => p.id === b.project_id);
      return { ...b, project_name: p ? p.name : null };
    })
    .sort((a, b) =>
      (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) ||
      b.created_at.localeCompare(a.created_at)
    );
}

// ─── Notes ───────────────────────────────────────────────────────────────────

function createNote(projectId, content) {
  const n = { id: uuidv4(), project_id: projectId, content, created_at: now() };
  store.notes.push(n);
  _touchProject(projectId);
  save();
  return n;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _touchProject(id) {
  const p = store.projects.find(p => p.id === id);
  if (p) p.updated_at = now();
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

function seedDemoData() {
  if (store.projects.length > 0) return;

  const mainCrm = createProject({
    name: 'Main CRM Platform',
    description: 'Core CRM platform with 30 integrated CRMs and 15 front-end websites',
    category: 'crm',
    status: 'active',
  });

  const crmNames = [
    'Salesforce','HubSpot','Zoho CRM','Pipedrive','Freshsales',
    'Monday.com CRM','Keap','ActiveCampaign','Copper','Insightly',
    'Close','Nutshell','Sugar CRM','Vtiger','Bitrix24',
    'Agile CRM','Streak','Capsule','Nimble','Apptivo',
    'Really Simple Systems','Less Annoying CRM','Ontraport','Drip','Creatio',
    'Dynamics 365','Oracle CRM','SAP CRM','Zendesk Sell','Podio',
  ];
  const crmStatuses = [
    'complete','complete','complete','complete','complete',
    'complete','complete','in_progress','in_progress','in_progress',
    'in_progress','not_started','not_started','not_started','not_started',
    'not_started','not_started','not_started','not_started','not_started',
    'not_started','not_started','not_started','not_started','not_started',
    'not_started','not_started','not_started','not_started','not_started',
  ];
  crmNames.forEach((name, i) =>
    createComponent(mainCrm.id, { name, type: 'crm', status: crmStatuses[i], description: `${name} CRM integration` })
  );

  const websiteNames = [
    'Landing Page','Client Portal','Admin Dashboard','Analytics Hub','Reporting Suite',
    'Mobile App (iOS)','Mobile App (Android)','Public API Docs','Partner Portal','Help Center',
    'Onboarding Wizard','Billing Portal','Status Page','Blog','Marketing Site',
  ];
  const webStatuses = [
    'complete','complete','complete','in_progress','in_progress',
    'not_started','not_started','not_started','not_started','not_started',
    'not_started','not_started','not_started','not_started','not_started',
  ];
  websiteNames.forEach((name, i) =>
    createComponent(mainCrm.id, { name, type: 'website', status: webStatuses[i], description: `${name} frontend` })
  );

  const proj2 = createProject({ name: 'E-Commerce Platform', description: 'Full-stack online store with payment integration', category: 'ecommerce', status: 'active' });
  createComponent(proj2.id, { name: 'Product Catalog',      type: 'feature',      status: 'complete' });
  createComponent(proj2.id, { name: 'Shopping Cart',        type: 'feature',      status: 'complete' });
  createComponent(proj2.id, { name: 'Stripe Checkout',      type: 'integration',  status: 'complete' });
  createComponent(proj2.id, { name: 'Inventory Management', type: 'feature',      status: 'in_progress' });
  createComponent(proj2.id, { name: 'Admin Panel',          type: 'website',      status: 'in_progress' });
  createComponent(proj2.id, { name: 'Email Notifications',  type: 'integration',  status: 'not_started' });

  const proj3 = createProject({ name: 'Client Booking System', description: 'Appointment scheduling and calendar management', category: 'saas', status: 'active' });
  createComponent(proj3.id, { name: 'Calendar View',          type: 'feature',     status: 'complete' });
  createComponent(proj3.id, { name: 'Booking Form',           type: 'feature',     status: 'complete' });
  createComponent(proj3.id, { name: 'SMS Reminders',          type: 'integration', status: 'not_started' });
  createComponent(proj3.id, { name: 'Google Calendar Sync',   type: 'integration', status: 'not_started' });

  const proj4 = createProject({ name: 'Analytics Dashboard', description: 'Real-time business intelligence and reporting', category: 'analytics', status: 'in_progress' });
  createComponent(proj4.id, { name: 'Data Pipeline', type: 'backend',  status: 'in_progress' });
  createComponent(proj4.id, { name: 'Chart Library',  type: 'frontend', status: 'not_started' });
  createComponent(proj4.id, { name: 'Export to PDF',  type: 'feature',  status: 'not_started' });

  createBugReport({
    project_id:          mainCrm.id,
    affected_area:       'Salesforce Integration',
    bug_type:            'sync',
    description:         'Contact sync fails silently when more than 500 records are queued',
    steps_to_reproduce:  '1. Queue 500+ contacts for sync\n2. Trigger manual sync\n3. Check sync log',
    expected_behavior:   'All contacts sync successfully',
    actual_behavior:     'Sync stops at record 487 with no error message',
    severity:            'high',
    frequency:           'always',
    reporter_name:       'System Monitor',
    reporter_email:      'monitor@internal.com',
  });

  createBugReport({
    project_id:   proj2.id,
    affected_area:'Stripe Checkout',
    bug_type:     'payment',
    description:  'Checkout form freezes on mobile Safari after entering card details',
    steps_to_reproduce: '1. Open site on iPhone Safari\n2. Add item to cart\n3. Enter card number\n4. Form becomes unresponsive',
    severity:     'critical',
    frequency:    'always',
    reporter_name:'Jane Customer',
    reporter_email:'jane@example.com',
    browser:      'Safari 17',
    device:       'iPhone 15',
  });
}

module.exports = {
  getAllProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  createComponent,
  updateComponent,
  deleteComponent,
  createBugReport,
  getBugById,
  updateBugReport,
  getAllOpenBugs,
  createNote,
  seedDemoData,
};
