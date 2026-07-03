require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const db = require('./database');
const { analyzeBugReport, suggestComponentMatch } = require('./claude-analyzer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── WebSocket broadcast ──────────────────────────────────────────────────────

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, ts: Date.now() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'connected', payload: { message: 'Command Center live' } }));
});

// ─── Projects ────────────────────────────────────────────────────────────────

app.get('/api/projects', (req, res) => {
  try {
    res.json(db.getAllProjects());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects/:id', (req, res) => {
  try {
    const p = db.getProjectById(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json(p);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects', (req, res) => {
  try {
    const p = db.createProject(req.body);
    broadcast('project_created', p);
    res.status(201).json(p);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/projects/:id', (req, res) => {
  try {
    const p = db.updateProject(req.params.id, req.body);
    if (!p) return res.status(404).json({ error: 'Not found' });
    broadcast('project_updated', p);
    res.json(p);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/projects/:id', (req, res) => {
  try {
    db.deleteProject(req.params.id);
    broadcast('project_deleted', { id: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Components ──────────────────────────────────────────────────────────────

app.post('/api/projects/:id/components', (req, res) => {
  try {
    const comp = db.createComponent(req.params.id, req.body);
    const project = db.getProjectById(req.params.id);
    broadcast('project_updated', project);
    res.status(201).json(comp);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/components/:id', (req, res) => {
  try {
    const comp = db.updateComponent(req.params.id, req.body);
    if (comp) {
      const project = db.getProjectById(comp.project_id);
      broadcast('project_updated', project);
    }
    res.json(comp);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/components/:id', (req, res) => {
  try {
    db.deleteComponent(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Bug Reports ─────────────────────────────────────────────────────────────

app.get('/api/bugs', (req, res) => {
  try {
    res.json(db.getAllOpenBugs());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/bugs/:id', (req, res) => {
  try {
    const bug = db.updateBugReport(req.params.id, req.body);
    if (bug && bug.project_id) {
      broadcast('project_updated', db.getProjectById(bug.project_id));
    }
    broadcast('bug_updated', bug);
    res.json(bug);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Claude Analysis ─────────────────────────────────────────────────────────

app.post('/api/bugs/:id/analyze', async (req, res) => {
  try {
    const bug = db.getBugById(req.params.id);
    if (!bug) return res.status(404).json({ error: 'Bug not found' });

    const project = bug.project_id ? db.getProjectById(bug.project_id) : { name: 'Unknown', category: 'unknown', description: '' };
    const components = project ? project.components : [];

    broadcast('analysis_started', { bug_id: bug.id });

    if (!bug.component_id && components.length > 0) {
      const matched = await suggestComponentMatch(bug.description, components);
      if (matched) {
        db.updateBugReport(bug.id, { component_id: matched.id });
      }
    }

    const analysis = await analyzeBugReport(project, bug, components);
    const now = new Date().toISOString();
    const updated = db.updateBugReport(bug.id, { claude_analysis: analysis, claude_analyzed_at: now });

    if (updated && updated.project_id) {
      broadcast('project_updated', db.getProjectById(updated.project_id));
    }
    broadcast('analysis_complete', { bug_id: bug.id, analysis });

    res.json({ bug_id: bug.id, analysis });
  } catch (e) {
    broadcast('analysis_error', { bug_id: req.params.id, error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// ─── Webhook from PHP Bug Form ────────────────────────────────────────────────

app.post('/api/webhook/bug-report', async (req, res) => {
  try {
    const data = req.body;

    if (!data.description || !data.affected_area) {
      return res.status(400).json({ error: 'description and affected_area are required' });
    }

    const bug = db.createBugReport(data);
    broadcast('bug_flagged', bug);

    if (bug.project_id) {
      const project = db.getProjectById(bug.project_id);
      broadcast('project_updated', project);
    }

    res.status(201).json({ ok: true, bug_id: bug.id, message: 'Bug report received. Our team has been notified.' });

    if (process.env.ANTHROPIC_API_KEY) {
      setImmediate(async () => {
        try {
          const project = bug.project_id ? db.getProjectById(bug.project_id) : { name: 'Unknown', category: 'unknown', description: '' };
          const components = project ? project.components : [];

          if (!bug.component_id && components.length > 0) {
            const matched = await suggestComponentMatch(bug.description, components);
            if (matched) db.updateBugReport(bug.id, { component_id: matched.id });
          }

          const analysis = await analyzeBugReport(project, bug, components);
          const now = new Date().toISOString();
          db.updateBugReport(bug.id, { claude_analysis: analysis, claude_analyzed_at: now });
          broadcast('analysis_complete', { bug_id: bug.id, analysis });

          if (bug.project_id) {
            broadcast('project_updated', db.getProjectById(bug.project_id));
          }
        } catch (err) {
          console.error('Auto-analysis failed:', err.message);
          broadcast('analysis_error', { bug_id: bug.id, error: err.message });
        }
      });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Notes ───────────────────────────────────────────────────────────────────

app.post('/api/projects/:id/notes', (req, res) => {
  try {
    const note = db.createNote(req.params.id, req.body.content);
    broadcast('project_updated', db.getProjectById(req.params.id));
    res.status(201).json(note);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Seed ─────────────────────────────────────────────────────────────────────

app.post('/api/seed', (req, res) => {
  try {
    db.seedDemoData();
    res.json({ ok: true, message: 'Demo data seeded' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Command Center running on http://localhost:${PORT}`);
  try {
    db.seedDemoData();
    console.log('Demo data initialized');
  } catch (e) {
    console.log('Database ready (data exists)');
  }
});
