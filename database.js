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

  const openBugs     = bugs.filter(b => b.status === 'open');
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

// ─── Real Project Seed Data ───────────────────────────────────────────────────

function seedDemoData() {
  if (store.projects.length > 0) return;

  // ── Save-A-Scoop E-Commerce ──────────────────────────────────────────────
  const saveascoop = createProject({
    name: 'Save-A-Scoop E-Commerce',
    description: 'Multi-role ice cream e-commerce platform with influencer/rep attribution, dealer portals, NMI payments, auto-print labels, and advanced order management.',
    category: 'ecommerce',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Public Storefront',         type: 'website',     status: 'complete' },
    { name: 'Dealer Portal',             type: 'website',     status: 'complete' },
    { name: 'Influencer Dashboard',      type: 'website',     status: 'complete' },
    { name: 'Admin Panel',               type: 'website',     status: 'complete' },
    { name: 'NMI Payment Integration',   type: 'integration', status: 'complete' },
    { name: 'Referral / Attribution',    type: 'feature',     status: 'complete' },
    { name: 'Auto-Print Label System',   type: 'feature',     status: 'complete' },
    { name: 'Shipping Integration',      type: 'integration', status: 'complete' },
    { name: 'Influencer Contract Gen',   type: 'feature',     status: 'complete' },
    { name: 'Accounting Module',         type: 'feature',     status: 'in_progress' },
    { name: 'E2E Testing Suite',         type: 'backend',     status: 'in_progress' },
    { name: 'Dealer Bundle Pages',       type: 'website',     status: 'in_progress' },
  ].forEach(c => createComponent(saveascoop.id, c));

  // ── MainelyCRM ───────────────────────────────────────────────────────────
  const mcrm = createProject({
    name: 'MainelyCRM',
    description: 'One CRM platform, many business models. Single PHP/MySQL codebase hosting admin dashboards for any client with industry packs deciding dashboard contents.',
    category: 'crm',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Core Authentication & RBAC', type: 'backend',     status: 'complete' },
    { name: 'Dashboard Engine',           type: 'backend',     status: 'complete' },
    { name: 'Industry Pack System',       type: 'backend',     status: 'complete' },
    { name: 'Client Provisioning',        type: 'backend',     status: 'complete' },
    { name: 'Module: Records',            type: 'feature',     status: 'complete' },
    { name: 'Module: Forms',              type: 'feature',     status: 'complete' },
    { name: 'Module: Dashboard',          type: 'feature',     status: 'complete' },
    { name: 'Module: Launcher',           type: 'feature',     status: 'complete' },
    { name: 'Module: Reporting',          type: 'feature',     status: 'in_progress' },
    { name: 'Multi-tenant Billing',       type: 'feature',     status: 'in_progress' },
    { name: 'Client-facing Portal',       type: 'website',     status: 'not_started' },
    { name: 'API for 3rd-party integrations', type: 'api',    status: 'not_started' },
  ].forEach(c => createComponent(mcrm.id, c));

  // ── Strategy & Design LLC (SD207) ────────────────────────────────────────
  const sd207 = createProject({
    name: 'Strategy & Design LLC (SD-207)',
    description: 'Company marketing website with admin portal, portfolio, case studies, client automation, build engine, and analytics.',
    category: 'website',
    live_url: 'https://sd207.com',
    status: 'active',
  });
  [
    { name: 'Marketing Website',     type: 'website',  status: 'complete' },
    { name: 'Portfolio / Case Studies', type: 'website', status: 'complete' },
    { name: 'Admin Portal',          type: 'website',  status: 'complete' },
    { name: 'Build Engine',          type: 'backend',  status: 'complete' },
    { name: 'Client Automation',     type: 'feature',  status: 'complete' },
    { name: 'Analytics Dashboard',   type: 'feature',  status: 'complete' },
    { name: 'API',                   type: 'api',      status: 'complete' },
    { name: 'Command Center (this)', type: 'tool',     status: 'in_progress' },
  ].forEach(c => createComponent(sd207.id, c));

  // ── Web Dev Team Platform ────────────────────────────────────────────────
  const webdevteam = createProject({
    name: 'Web Dev Team Platform',
    description: 'Internal team platform with project builder, multi-file code editor, code dashboard, auth, and security hardening.',
    category: 'saas',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Authentication',      type: 'backend',  status: 'complete' },
    { name: 'Project Builder',     type: 'feature',  status: 'complete' },
    { name: 'Code Editor',         type: 'feature',  status: 'complete' },
    { name: 'Code Dashboard',      type: 'feature',  status: 'complete' },
    { name: 'API Layer',           type: 'api',      status: 'complete' },
    { name: 'File Upload / SVG Security', type: 'feature', status: 'complete' },
    { name: 'Session Fixation Fix', type: 'backend', status: 'complete' },
    { name: 'Multi-user Collab',   type: 'feature',  status: 'not_started' },
  ].forEach(c => createComponent(webdevteam.id, c));

  // ── Dev IQ Dashboard ─────────────────────────────────────────────────────
  const deviq = createProject({
    name: 'Dev IQ Dashboard',
    description: 'DevOps hub and project template builder with code editor, content library, animation system, and full production-ready backend.',
    category: 'saas',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Project Manager',      type: 'feature',  status: 'complete' },
    { name: 'Code Editor',          type: 'feature',  status: 'complete' },
    { name: 'Template Builder',     type: 'feature',  status: 'complete' },
    { name: 'Content Library',      type: 'feature',  status: 'complete' },
    { name: 'Animation System',     type: 'feature',  status: 'complete' },
    { name: 'Backend API',          type: 'api',      status: 'complete' },
    { name: 'Database Layer',       type: 'backend',  status: 'complete' },
    { name: 'Production Deploy',    type: 'backend',  status: 'in_progress' },
  ].forEach(c => createComponent(deviq.id, c));

  // ── MERCH (POD SaaS) ─────────────────────────────────────────────────────
  const merch = createProject({
    name: 'MERCH — Print-on-Demand SaaS',
    description: 'Multi-provider print-on-demand SaaS store with native ad management across Facebook, Google Ads, TikTok Ads, and X Ads.',
    category: 'saas',
    live_url: '',
    status: 'in_progress',
  });
  [
    { name: 'Storefront',              type: 'website',     status: 'complete' },
    { name: 'Shopping Cart',           type: 'feature',     status: 'complete' },
    { name: 'Checkout / Payments',     type: 'feature',     status: 'complete' },
    { name: 'Admin Panel',             type: 'website',     status: 'complete' },
    { name: 'Multi-provider Print API',type: 'integration', status: 'in_progress' },
    { name: 'Facebook Ads Manager',    type: 'integration', status: 'not_started' },
    { name: 'Google Ads Manager',      type: 'integration', status: 'not_started' },
    { name: 'TikTok Ads Manager',      type: 'integration', status: 'not_started' },
    { name: 'X Ads Manager',           type: 'integration', status: 'not_started' },
    { name: 'Analytics Dashboard',     type: 'feature',     status: 'not_started' },
  ].forEach(c => createComponent(merch.id, c));

  // ── UnitProof ────────────────────────────────────────────────────────────
  const unitproof = createProject({
    name: 'UnitProof',
    description: 'Self-hosted Record360 replacement — phone-first equipment condition documentation and proof-of-delivery signatures for an equipment-servicing dealership.',
    category: 'saas',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Photo Documentation',   type: 'feature',  status: 'complete' },
    { name: 'Digital Signatures',    type: 'feature',  status: 'complete' },
    { name: 'Customer Portal',       type: 'website',  status: 'complete' },
    { name: 'Engagement Tracking',   type: 'feature',  status: 'complete' },
    { name: 'Side-by-side Compare',  type: 'feature',  status: 'complete' },
    { name: 'Admin Dashboard',       type: 'website',  status: 'complete' },
    { name: 'PDF Report Export',     type: 'feature',  status: 'in_progress' },
    { name: 'Mobile-native PWA',     type: 'mobile',   status: 'not_started' },
  ].forEach(c => createComponent(unitproof.id, c));

  // ── SR1 Logistics Portal ─────────────────────────────────────────────────
  const logistics = createProject({
    name: 'SR1 Logistics Portal',
    description: 'Comprehensive logistics management system for SR1 Companies — driver schedules, deliveries, transfer fees, and historical records.',
    category: 'saas',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Driver Schedule Management', type: 'feature',  status: 'complete' },
    { name: 'Delivery Tracking',          type: 'feature',  status: 'complete' },
    { name: 'Transfer Fee Management',    type: 'feature',  status: 'complete' },
    { name: 'Historical Records',         type: 'feature',  status: 'complete' },
    { name: 'Admin Dashboard',            type: 'website',  status: 'complete' },
    { name: 'Import / Data Migration',    type: 'backend',  status: 'complete' },
  ].forEach(c => createComponent(logistics.id, c));

  // ── ShopTrack ────────────────────────────────────────────────────────────
  const shoptrack = createProject({
    name: 'ShopTrack',
    description: 'STR turnover shop tracker — QR-code-based laundry bag and package tracking for a short-term-rental cleaning company.',
    category: 'saas',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'QR Code Intake',        type: 'feature',  status: 'complete' },
    { name: 'Property Tracking',     type: 'feature',  status: 'complete' },
    { name: 'Laundry Bag Tracking',  type: 'feature',  status: 'complete' },
    { name: 'Package Tracking',      type: 'feature',  status: 'complete' },
    { name: 'Thermal Sticker Print', type: 'feature',  status: 'complete' },
    { name: 'Staff Dashboard',       type: 'website',  status: 'complete' },
  ].forEach(c => createComponent(shoptrack.id, c));

  // ── SR1 Trailers Warranty Dashboard ──────────────────────────────────────
  const sr1trailers = createProject({
    name: 'SR1 Trailers Warranty Dashboard',
    description: 'Warranty tracking and management dashboard for SR1 Trailers — Loudon, NH. Includes job rates, meeting agendas, and data import.',
    category: 'saas',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Warranty Dashboard',    type: 'feature',  status: 'complete' },
    { name: 'Job Rate Management',   type: 'feature',  status: 'complete' },
    { name: 'Data Import',           type: 'backend',  status: 'complete' },
    { name: 'Meeting Agendas',       type: 'feature',  status: 'complete' },
  ].forEach(c => createComponent(sr1trailers.id, c));

  // ── Turner Equipment Dashboard (AGING) ───────────────────────────────────
  const aging = createProject({
    name: 'Turner Equipment Dashboard',
    description: 'Equipment aging and repair analytics dashboard for Turner location — tracks unit repair timelines, tech performance, parts costs, and lot management.',
    category: 'analytics',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Repair Tracking',       type: 'feature',  status: 'complete' },
    { name: 'Tech Performance Reports', type: 'feature', status: 'complete' },
    { name: 'Aging Analysis',        type: 'feature',  status: 'complete' },
    { name: 'Lot Management',        type: 'feature',  status: 'complete' },
    { name: 'CSV Data Seeder',       type: 'backend',  status: 'complete' },
  ].forEach(c => createComponent(aging.id, c));

  // ── Repair Dashboard ─────────────────────────────────────────────────────
  const repairDash = createProject({
    name: 'Equipment Service & Sales Dashboard',
    description: 'Multi-location equipment service and sales dashboard with unit tracking, location management, service records, and repair status.',
    category: 'analytics',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Unit Tracking',         type: 'feature',  status: 'complete' },
    { name: 'Location Management',   type: 'feature',  status: 'complete' },
    { name: 'Service Records',       type: 'feature',  status: 'complete' },
    { name: 'Repair Status',         type: 'feature',  status: 'complete' },
    { name: 'Dashboard API',         type: 'api',      status: 'complete' },
  ].forEach(c => createComponent(repairDash.id, c));

  // ── PROPS Trading Tool ───────────────────────────────────────────────────
  const props = createProject({
    name: 'PROPS Trading Tool',
    description: 'Stock/prop trading dashboard and data tool with realistic data generation, trade tracking, daily adds, and analytics.',
    category: 'tool',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Trade Dashboard',       type: 'feature',  status: 'complete' },
    { name: 'Daily Trade Adds',      type: 'feature',  status: 'complete' },
    { name: 'Realistic Data Gen',    type: 'backend',  status: 'complete' },
    { name: 'Credit Memo System',    type: 'feature',  status: 'complete' },
    { name: 'Browser Profile Mgmt',  type: 'feature',  status: 'complete' },
  ].forEach(c => createComponent(props.id, c));

  // ── TYM Tool ─────────────────────────────────────────────────────────────
  const tym = createProject({
    name: 'TYM Tool',
    description: 'Python browser automation tool with multi-profile support, dashboard, credit memo management, and backup system.',
    category: 'tool',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Python Automation Engine', type: 'backend',  status: 'complete' },
    { name: 'Web Dashboard',            type: 'website',  status: 'complete' },
    { name: 'Multi-browser Profiles',   type: 'feature',  status: 'complete' },
    { name: 'Credit Memo Manager',      type: 'feature',  status: 'complete' },
    { name: 'Backup System',            type: 'backend',  status: 'complete' },
  ].forEach(c => createComponent(tym.id, c));

  // ── Salem Kustom Leathers ────────────────────────────────────────────────
  const skl = createProject({
    name: 'Salem Kustom Leathers',
    description: 'Custom leather craftsman e-commerce — storefront, user accounts, shopping cart, Stripe checkout, and full admin dashboard.',
    category: 'ecommerce',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Public Storefront',     type: 'website',     status: 'complete' },
    { name: 'User Accounts',         type: 'feature',     status: 'complete' },
    { name: 'Shopping Cart',         type: 'feature',     status: 'complete' },
    { name: 'Stripe Checkout',       type: 'integration', status: 'complete' },
    { name: 'Product Management',    type: 'feature',     status: 'complete' },
    { name: 'Order Management',      type: 'feature',     status: 'complete' },
    { name: 'Admin Dashboard',       type: 'website',     status: 'complete' },
    { name: 'Lead Tracking',         type: 'feature',     status: 'complete' },
    { name: 'Analytics',             type: 'feature',     status: 'complete' },
  ].forEach(c => createComponent(skl.id, c));

  // ── TREELOCK Artist Site + Merch ─────────────────────────────────────────
  const treelock = createProject({
    name: 'TREELOCK — Artist Website & Merch',
    description: 'Music artist website with Spotify embed, merch store, Printify integration, and full checkout.',
    category: 'ecommerce',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Artist Website',        type: 'website',     status: 'complete' },
    { name: 'Music / Spotify Embed', type: 'integration', status: 'complete' },
    { name: 'Merch Store',           type: 'website',     status: 'complete' },
    { name: 'Printify Integration',  type: 'integration', status: 'complete' },
    { name: 'Checkout',              type: 'feature',     status: 'complete' },
    { name: 'Admin Panel',           type: 'website',     status: 'complete' },
  ].forEach(c => createComponent(treelock.id, c));

  // ── K&L Auto Detailing ───────────────────────────────────────────────────
  const detailing = createProject({
    name: 'K&L Auto Detailing',
    description: 'Mobile-first "Cinematic Garage" design website + owner portal for K&L Auto Detailing (Trevor Knudsen). Built for Hostinger deploy.',
    category: 'website',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Public Website',        type: 'website',  status: 'complete' },
    { name: 'Owner Admin Portal',    type: 'website',  status: 'complete' },
    { name: 'Service Management',    type: 'feature',  status: 'complete' },
    { name: 'Booking System',        type: 'feature',  status: 'complete' },
    { name: 'Gallery',               type: 'feature',  status: 'complete' },
    { name: 'API',                   type: 'api',      status: 'complete' },
  ].forEach(c => createComponent(detailing.id, c));

  // ── Small Wonders Child Care ─────────────────────────────────────────────
  const smallwonders = createProject({
    name: 'Small Wonders Child Care',
    description: 'Rebuild of smallwondersccf.com — mobile-first public site plus PHP/MySQL admin dashboard and parent portal.',
    category: 'website',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Public Website',        type: 'website',  status: 'complete' },
    { name: 'Parent Portal',         type: 'website',  status: 'complete' },
    { name: 'Admin Dashboard',       type: 'website',  status: 'complete' },
    { name: 'Child Records',         type: 'feature',  status: 'complete' },
    { name: 'Billing Management',    type: 'feature',  status: 'complete' },
    { name: 'Media Library',         type: 'feature',  status: 'complete' },
    { name: 'Messaging System',      type: 'feature',  status: 'complete' },
    { name: 'Staff Portal',          type: 'website',  status: 'in_progress' },
  ].forEach(c => createComponent(smallwonders.id, c));

  // ── Traxler Trucking ─────────────────────────────────────────────────────
  const traxler = createProject({
    name: 'Traxler Trucking, Inc.',
    description: 'Full PHP/MySQL site for Traxler Trucking — marketing website, working quote form with lead DB, and back-office dispatch portal mockup.',
    category: 'website',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Marketing Website',     type: 'website',  status: 'complete' },
    { name: 'Quote / Contact Form',  type: 'feature',  status: 'complete' },
    { name: 'Lead Database',         type: 'backend',  status: 'complete' },
    { name: 'Back-office Portal',    type: 'website',  status: 'complete' },
    { name: 'Admin Panel',           type: 'website',  status: 'complete' },
  ].forEach(c => createComponent(traxler.id, c));

  // ── Travis West LLC ──────────────────────────────────────────────────────
  const twllc = createProject({
    name: 'Travis West LLC',
    description: 'Mobile-first general contractors website with service pages, contact form, and admin.',
    category: 'website',
    live_url: '',
    status: 'complete',
  });
  [
    { name: 'Public Website',        type: 'website',  status: 'complete' },
    { name: 'Service Pages',         type: 'website',  status: 'complete' },
    { name: 'Contact Form',          type: 'feature',  status: 'complete' },
    { name: 'Admin',                 type: 'website',  status: 'complete' },
  ].forEach(c => createComponent(twllc.id, c));

  // ── TWCS ─────────────────────────────────────────────────────────────────
  const twcs = createProject({
    name: 'Travis West Contracting Services',
    description: 'PHP/MySQL contractor services website with admin portal and privacy policy.',
    category: 'website',
    live_url: '',
    status: 'complete',
  });
  [
    { name: 'Public Website',        type: 'website',  status: 'complete' },
    { name: 'Admin Portal',          type: 'website',  status: 'complete' },
    { name: 'Contact / Leads',       type: 'feature',  status: 'complete' },
  ].forEach(c => createComponent(twcs.id, c));

  // ── T&G Services ─────────────────────────────────────────────────────────
  const tgservices = createProject({
    name: 'T&G Services',
    description: 'Landing site for T&G Services — automotive / mechanical repair shop. PHP + MySQL + HTML/CSS.',
    category: 'website',
    live_url: '',
    status: 'complete',
  });
  [
    { name: 'Landing Page',          type: 'website',  status: 'complete' },
    { name: 'Services Page',         type: 'website',  status: 'complete' },
    { name: 'Appointment Booking',   type: 'feature',  status: 'complete' },
    { name: 'Admin Portal',          type: 'website',  status: 'complete' },
    { name: 'Contact Form',          type: 'feature',  status: 'complete' },
  ].forEach(c => createComponent(tgservices.id, c));

  // ── T&B Custom Clean ─────────────────────────────────────────────────────
  const tbcleaning = createProject({
    name: 'T&B Custom Clean',
    description: 'Cleaning company website with geo-targeting, multi-location review feeds, gallery, and admin portal.',
    category: 'website',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Public Website',        type: 'website',  status: 'complete' },
    { name: 'Gallery',               type: 'feature',  status: 'complete' },
    { name: 'Service Area Pages',    type: 'website',  status: 'complete' },
    { name: 'Contact Form',          type: 'feature',  status: 'complete' },
    { name: 'Admin / Login',         type: 'website',  status: 'complete' },
    { name: 'Geo-targeting',         type: 'feature',  status: 'complete' },
    { name: 'Review Feed Migration', type: 'backend',  status: 'complete' },
  ].forEach(c => createComponent(tbcleaning.id, c));

  // ── Tireman / Local Tires ────────────────────────────────────────────────
  const tireman = createProject({
    name: 'Local Tires — Mobile Tire Service',
    description: 'Website and CRM for Local Tires mobile tire service and roadside assistance business.',
    category: 'website',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Public Website',        type: 'website',  status: 'complete' },
    { name: 'Customer Portal',       type: 'website',  status: 'complete' },
    { name: 'Admin Dashboard',       type: 'website',  status: 'complete' },
    { name: 'Booking / Scheduling',  type: 'feature',  status: 'complete' },
    { name: 'Install.php Setup',     type: 'backend',  status: 'complete' },
  ].forEach(c => createComponent(tireman.id, c));

  // ── Artist Spotlight ─────────────────────────────────────────────────────
  const artistSpotlight = createProject({
    name: 'Artist Spotlight',
    description: 'Artist EPK and spotlight website with gallery, press kit, subscription, and Suno auto-generation integration.',
    category: 'website',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Artist Profile Page',   type: 'website',  status: 'complete' },
    { name: 'EPK (Press Kit)',        type: 'website',  status: 'complete' },
    { name: 'Gallery',               type: 'feature',  status: 'complete' },
    { name: 'Subscribe System',      type: 'feature',  status: 'complete' },
    { name: 'Admin Panel',           type: 'website',  status: 'complete' },
    { name: 'Suno Auto-gen',         type: 'integration', status: 'in_progress' },
    { name: 'DB Setup / Migrations', type: 'backend',  status: 'complete' },
  ].forEach(c => createComponent(artistSpotlight.id, c));

  // ── NOIR Studio (Hair Salon) ─────────────────────────────────────────────
  const hairsalon = createProject({
    name: 'NOIR Studio — Hair Salon',
    description: 'Full hair salon website with online booking, gallery, reviews, staff schedules, and service management.',
    category: 'website',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Public Website',        type: 'website',  status: 'complete' },
    { name: 'Online Booking',        type: 'feature',  status: 'complete' },
    { name: 'Gallery',               type: 'feature',  status: 'complete' },
    { name: 'Reviews',               type: 'feature',  status: 'complete' },
    { name: 'Staff Schedule',        type: 'feature',  status: 'complete' },
    { name: 'Services Management',   type: 'feature',  status: 'complete' },
    { name: 'Admin Portal',          type: 'website',  status: 'in_progress' },
  ].forEach(c => createComponent(hairsalon.id, c));

  // ── Fade & Blade Barbershop ───────────────────────────────────────────────
  const barbershop = createProject({
    name: 'Fade & Blade Barbershop',
    description: 'Premium barbershop website with online booking, barber profiles, service management, and appointment system.',
    category: 'website',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Public Website',        type: 'website',  status: 'complete' },
    { name: 'Barber Profiles',       type: 'feature',  status: 'complete' },
    { name: 'Online Booking',        type: 'feature',  status: 'complete' },
    { name: 'Services Management',   type: 'feature',  status: 'complete' },
    { name: 'Appointments System',   type: 'feature',  status: 'complete' },
    { name: 'Gallery',               type: 'feature',  status: 'complete' },
  ].forEach(c => createComponent(barbershop.id, c));

  // ── Hound & Hand Grooming ─────────────────────────────────────────────────
  const houndhand = createProject({
    name: 'Hound & Hand Grooming Co.',
    description: 'Boutique dog & cat grooming website with booking system, customer CRM, gallery, and groomer dashboard.',
    category: 'website',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Public Website',        type: 'website',  status: 'complete' },
    { name: 'Online Booking',        type: 'feature',  status: 'complete' },
    { name: 'Customer CRM',          type: 'feature',  status: 'complete' },
    { name: 'Gallery',               type: 'feature',  status: 'complete' },
    { name: 'Groomer Dashboard',     type: 'website',  status: 'complete' },
  ].forEach(c => createComponent(houndhand.id, c));

  // ── Elevate Nutrition ─────────────────────────────────────────────────────
  const elevate = createProject({
    name: 'Elevate Nutrition',
    description: 'Smoothie, juice & daily fuel shop website with booking, customer CRM, and staff dashboard.',
    category: 'website',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Public Website',        type: 'website',  status: 'complete' },
    { name: 'Menu / Products',       type: 'feature',  status: 'complete' },
    { name: 'Booking System',        type: 'feature',  status: 'complete' },
    { name: 'Customer CRM',          type: 'feature',  status: 'complete' },
    { name: 'Staff Dashboard',       type: 'website',  status: 'complete' },
    { name: 'Gallery',               type: 'feature',  status: 'complete' },
  ].forEach(c => createComponent(elevate.id, c));

  // ── Cardinal Heating & Cooling ───────────────────────────────────────────
  const hvac = createProject({
    name: 'Cardinal Heating & Cooling',
    description: 'HVAC contractor website for Cardinal Heating & Cooling, Carbondale — service pages, tech profiles, booking, gallery.',
    category: 'website',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Public Website',        type: 'website',  status: 'complete' },
    { name: 'Service Pages',         type: 'website',  status: 'complete' },
    { name: 'Tech Profiles',         type: 'feature',  status: 'complete' },
    { name: 'Booking System',        type: 'feature',  status: 'complete' },
    { name: 'Gallery',               type: 'feature',  status: 'complete' },
    { name: 'Customer CRM',          type: 'feature',  status: 'complete' },
    { name: 'Dashboard',             type: 'website',  status: 'complete' },
  ].forEach(c => createComponent(hvac.id, c));

  // ── EVERLETRIC ───────────────────────────────────────────────────────────
  const everletric = createProject({
    name: 'EVERLETRIC',
    description: 'Licensed electrical contractor website for Carbondale, IL — electrician profiles, services, booking, and dashboard.',
    category: 'website',
    live_url: '',
    status: 'active',
  });
  [
    { name: 'Public Website',        type: 'website',  status: 'complete' },
    { name: 'Electrician Profiles',  type: 'feature',  status: 'complete' },
    { name: 'Services',              type: 'website',  status: 'complete' },
    { name: 'Booking System',        type: 'feature',  status: 'complete' },
    { name: 'Customer Dashboard',    type: 'website',  status: 'complete' },
  ].forEach(c => createComponent(everletric.id, c));

  // ── Ace Contracting Services ─────────────────────────────────────────────
  const ace = createProject({
    name: 'Ace Contracting Services',
    description: 'Trusted contractor services website for Lewiston, ME — services, gallery, admin.',
    category: 'website',
    live_url: '',
    status: 'complete',
  });
  [
    { name: 'Public Website',        type: 'website',  status: 'complete' },
    { name: 'Services / Gallery',    type: 'website',  status: 'complete' },
    { name: 'Admin',                 type: 'website',  status: 'complete' },
  ].forEach(c => createComponent(ace.id, c));

  // ── Our Sandbox ───────────────────────────────────────────────────────────
  const oursandbox = createProject({
    name: 'Our Sandbox',
    description: 'Custom sandblasting & etched glass gifts website — services, gallery, contact, sitemap, privacy policy.',
    category: 'website',
    live_url: '',
    status: 'complete',
  });
  [
    { name: 'Public Website',        type: 'website',  status: 'complete' },
    { name: 'Services Page',         type: 'website',  status: 'complete' },
    { name: 'Gallery',               type: 'feature',  status: 'complete' },
    { name: 'Contact Form',          type: 'feature',  status: 'complete' },
    { name: 'Admin Portal',          type: 'website',  status: 'complete' },
  ].forEach(c => createComponent(oursandbox.id, c));

  // ── Sites Template Library ───────────────────────────────────────────────
  const sites = createProject({
    name: 'Industry Website Template Library',
    description: '34 industry-specific website templates — autorepair, brewery, catering, charters, construction, daycare, electrical, hotel, lawfirm, and more.',
    category: 'template',
    live_url: '',
    status: 'active',
  });
  const siteTemplates = [
    'Auto Repair', 'Brewery', 'Catering', 'Charters', 'Collectibles',
    'Construction', 'Daycare', 'Electrical', 'Events / Media', 'Fence',
    'Flooring', 'Food Truck', 'Hotel', 'HVAC', 'Law Firm',
    'Lawn Care', 'Lila Fence', 'Logging', 'Logistics', 'Marina',
    'Pest Control', 'Pet Grooming', 'Photography', 'Plumbing', 'Pool Cleaning',
    'Portfolio', 'Property Management', 'Real Estate', 'Restaurant', 'Roofing',
    'Animal Shelter', '96 Farm Road', 'Charters (alt)', 'Logistics (alt)',
  ];
  siteTemplates.forEach((name, i) =>
    createComponent(sites.id, {
      name,
      type: 'template',
      status: i < 28 ? 'complete' : 'in_progress',
      description: `${name} industry website template`,
    })
  );

  console.log('Real project data seeded:', store.projects.length, 'projects');
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
