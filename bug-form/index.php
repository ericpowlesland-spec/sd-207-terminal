<?php
/**
 * SD-207 Customer Bug Report Form
 * Host this file on any PHP server.
 * Set COMMAND_CENTER_URL to your Node.js server's webhook endpoint.
 */

$COMMAND_CENTER_WEBHOOK = 'http://localhost:3000/api/webhook/bug-report';
$BRAND_NAME = 'SD-207 Support';

$success = false;
$error   = '';
$step    = isset($_POST['step']) ? (int)$_POST['step'] : 1;

// Available projects - you can populate this via an API call or hardcode
// Format: ['id' => 'project-uuid', 'name' => 'Display Name']
$projects = [];
try {
    $ctx = stream_context_create(['http' => ['timeout' => 3]]);
    $resp = @file_get_contents('http://localhost:3000/api/projects', false, $ctx);
    if ($resp) {
        $all = json_decode($resp, true);
        foreach ($all as $p) {
            $projects[] = ['id' => $p['id'], 'name' => $p['name']];
        }
    }
} catch (Exception $e) {}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $step === 3) {

    // Collect and sanitize
    $data = [
        'project_id'         => trim($_POST['project_id'] ?? ''),
        'reporter_name'      => trim($_POST['reporter_name'] ?? 'Anonymous'),
        'reporter_email'     => trim($_POST['reporter_email'] ?? ''),
        'affected_area'      => trim($_POST['affected_area'] ?? ''),
        'bug_type'           => trim($_POST['bug_type'] ?? 'functional'),
        'description'        => trim($_POST['description'] ?? ''),
        'steps_to_reproduce' => trim($_POST['steps_to_reproduce'] ?? ''),
        'expected_behavior'  => trim($_POST['expected_behavior'] ?? ''),
        'actual_behavior'    => trim($_POST['actual_behavior'] ?? ''),
        'severity'           => trim($_POST['severity'] ?? 'medium'),
        'frequency'          => trim($_POST['frequency'] ?? 'sometimes'),
        'browser'            => trim($_POST['browser'] ?? ''),
        'device'             => trim($_POST['device'] ?? ''),
    ];

    if (empty($data['description']) || empty($data['affected_area'])) {
        $error = 'Please describe the bug and the area of the website affected.';
    } else {
        $payload = json_encode($data);
        $ctx = stream_context_create([
            'http' => [
                'method'  => 'POST',
                'header'  => "Content-Type: application/json\r\nContent-Length: " . strlen($payload),
                'content' => $payload,
                'timeout' => 10,
            ]
        ]);
        $result = @file_get_contents($COMMAND_CENTER_WEBHOOK, false, $ctx);
        if ($result !== false) {
            $success = true;
        } else {
            $error = 'We could not send your report right now. Please try again or email us directly.';
        }
    }
}

$step2_data = [
    'project_id'    => $_POST['project_id'] ?? '',
    'reporter_name' => $_POST['reporter_name'] ?? '',
    'reporter_email'=> $_POST['reporter_email'] ?? '',
    'affected_area' => $_POST['affected_area'] ?? '',
];
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Report a Bug &mdash; <?= htmlspecialchars($BRAND_NAME) ?></title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg:    #f4f6fa;
      --white: #ffffff;
      --text:  #1a1d2e;
      --muted: #6b7290;
      --accent:#4f8ef7;
      --red:   #f24e4e;
      --green: #00c77a;
      --border:#d8dce8;
      --radius:10px;
    }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; display: flex; align-items: flex-start; justify-content: center; padding: 40px 16px; }
    .card { background: var(--white); border-radius: var(--radius); box-shadow: 0 4px 24px rgba(0,0,0,.08); width: 100%; max-width: 580px; overflow: hidden; }

    .card-header { background: #1a1d2e; color: #fff; padding: 28px 32px; }
    .card-header h1 { font-size: 20px; font-weight: 800; margin-bottom: 4px; }
    .card-header p  { font-size: 13px; color: rgba(255,255,255,.6); }

    .progress-wrap { padding: 20px 32px 0; }
    .progress-steps { display: flex; gap: 0; counter-reset: step; }
    .step-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; position: relative; font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
    .step-item::before { counter-increment: step; content: counter(step); width: 28px; height: 28px; border-radius: 50%; background: var(--border); color: var(--muted); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; z-index: 1; }
    .step-item.active::before  { background: var(--accent); color: #fff; }
    .step-item.done::before    { background: var(--green); color: #fff; content: '✓'; }
    .step-item + .step-item::after { content: ''; position: absolute; left: -50%; top: 14px; width: 100%; height: 2px; background: var(--border); z-index: 0; }
    .step-item.done + .step-item::after { background: var(--green); }

    .card-body { padding: 28px 32px 32px; }

    .form-row { margin-bottom: 18px; }
    label { display: block; font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
    label .req { color: var(--red); }

    input[type=text], input[type=email], select, textarea {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 14px;
      color: var(--text);
      font-family: inherit;
      transition: border-color .15s;
      background: var(--white);
    }
    input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); }
    textarea { resize: vertical; }

    .hint { font-size: 12px; color: var(--muted); margin-top: 5px; }

    .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 11px 24px; border: none; border-radius: 6px; font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit; transition: opacity .15s; }
    .btn:hover { opacity: .88; }
    .btn-primary { background: var(--accent); color: #fff; width: 100%; margin-top: 6px; }
    .btn-back    { background: none; color: var(--muted); border: 1px solid var(--border); margin-right: 8px; padding: 10px 18px; }

    .error-box {
      background: rgba(242,78,78,.08);
      border: 1px solid rgba(242,78,78,.3);
      border-radius: 6px;
      padding: 12px 16px;
      color: var(--red);
      font-size: 13px;
      margin-bottom: 18px;
    }

    .success-box {
      text-align: center;
      padding: 40px 20px;
    }
    .success-icon { font-size: 56px; margin-bottom: 16px; }
    .success-box h2 { font-size: 22px; font-weight: 800; margin-bottom: 8px; }
    .success-box p  { font-size: 14px; color: var(--muted); line-height: 1.6; }

    .affected-area-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 6px; }
    .area-option { position: relative; }
    .area-option input[type=radio] { position: absolute; opacity: 0; width: 0; height: 0; }
    .area-label {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 12px 8px;
      border: 2px solid var(--border);
      border-radius: 8px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      text-align: center;
      transition: all .15s;
    }
    .area-label .icon { font-size: 22px; }
    .area-option input:checked + .area-label { border-color: var(--accent); color: var(--accent); background: rgba(79,142,247,.06); }
    .area-other { grid-column: 1 / -1; margin-top: 4px; }

    @media (max-width: 500px) {
      .card-body, .card-header, .progress-wrap { padding-left: 20px; padding-right: 20px; }
      .row-2 { grid-template-columns: 1fr; }
      .affected-area-grid { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
<div class="card">
  <div class="card-header">
    <h1>Report a Bug</h1>
    <p>Help us fix issues fast. Our team is notified immediately.</p>
  </div>

  <?php if ($success): ?>
    <div class="card-body">
      <div class="success-box">
        <div class="success-icon">&#10003;</div>
        <h2>Report Received!</h2>
        <p>Thank you for letting us know. Our team has been flagged and will investigate immediately. We&apos;ll follow up at <strong><?= htmlspecialchars($_POST['reporter_email'] ?? 'your email') ?></strong> as soon as we have an update.</p>
        <br>
        <a href="<?= htmlspecialchars($_SERVER['PHP_SELF']) ?>" style="color:var(--accent);font-weight:600">Submit another report</a>
      </div>
    </div>

  <?php else: ?>

    <div class="progress-wrap">
      <div class="progress-steps">
        <div class="step-item <?= $step >= 1 ? ($step > 1 ? 'done' : 'active') : '' ?>">Your Info</div>
        <div class="step-item <?= $step >= 2 ? ($step > 2 ? 'done' : 'active') : '' ?>">Location</div>
        <div class="step-item <?= $step >= 3 ? 'active' : '' ?>">Details</div>
      </div>
    </div>

    <div class="card-body">
      <?php if ($error): ?>
        <div class="error-box">&#9888; <?= htmlspecialchars($error) ?></div>
      <?php endif; ?>

      <!-- ── Step 1: Contact info + project ── -->
      <?php if ($step === 1): ?>
        <form method="POST">
          <input type="hidden" name="step" value="2"/>

          <div class="form-row">
            <label>Which website or product? <span class="req">*</span></label>
            <?php if (!empty($projects)): ?>
              <select name="project_id" required>
                <option value="">Select a project...</option>
                <?php foreach ($projects as $p): ?>
                  <option value="<?= htmlspecialchars($p['id']) ?>"><?= htmlspecialchars($p['name']) ?></option>
                <?php endforeach; ?>
              </select>
            <?php else: ?>
              <input type="text" name="project_id" placeholder="Which website or app are you using?" required/>
            <?php endif; ?>
          </div>

          <div class="row-2">
            <div class="form-row">
              <label>Your Name</label>
              <input type="text" name="reporter_name" value="<?= htmlspecialchars($_POST['reporter_name'] ?? '') ?>" placeholder="Jane Smith"/>
            </div>
            <div class="form-row">
              <label>Email Address</label>
              <input type="email" name="reporter_email" value="<?= htmlspecialchars($_POST['reporter_email'] ?? '') ?>" placeholder="you@example.com"/>
              <div class="hint">We&apos;ll only use this to follow up on your report.</div>
            </div>
          </div>

          <button type="submit" class="btn btn-primary">Next &rarr;</button>
        </form>

      <!-- ── Step 2: Affected area ── -->
      <?php elseif ($step === 2): ?>
        <form method="POST">
          <input type="hidden" name="step" value="3"/>
          <?php foreach ($step2_data as $k => $v): ?>
            <input type="hidden" name="<?= htmlspecialchars($k) ?>" value="<?= htmlspecialchars($v) ?>"/>
          <?php endforeach; ?>

          <div class="form-row">
            <label>Where is the issue happening? <span class="req">*</span></label>
            <div class="affected-area-grid">
              <?php
              $areas = [
                ['value' => 'Login / Authentication',  'icon' => '&#128274;', 'label' => 'Login / Sign Up'],
                ['value' => 'Dashboard / Home',         'icon' => '&#127968;', 'label' => 'Dashboard'],
                ['value' => 'Forms / Data Entry',       'icon' => '&#128203;', 'label' => 'Forms'],
                ['value' => 'Payments / Checkout',      'icon' => '&#128179;', 'label' => 'Payments'],
                ['value' => 'Reports / Analytics',      'icon' => '&#128200;', 'label' => 'Reports'],
                ['value' => 'Settings / Profile',       'icon' => '&#9881;',   'label' => 'Settings'],
                ['value' => 'Navigation / Menu',        'icon' => '&#9776;',   'label' => 'Navigation'],
                ['value' => 'Email / Notifications',    'icon' => '&#128140;', 'label' => 'Emails'],
                ['value' => 'Integrations / API',       'icon' => '&#128279;', 'label' => 'Integrations'],
              ];
              foreach ($areas as $a):
              ?>
                <div class="area-option">
                  <input type="radio" name="affected_area" id="area-<?= md5($a['value']) ?>" value="<?= htmlspecialchars($a['value']) ?>"/>
                  <label for="area-<?= md5($a['value']) ?>" class="area-label">
                    <span class="icon"><?= $a['icon'] ?></span>
                    <?= htmlspecialchars($a['label']) ?>
                  </label>
                </div>
              <?php endforeach; ?>
              <div class="area-option area-other">
                <input type="text" name="affected_area_other" placeholder="Other area — describe where you are on the site..."/>
              </div>
            </div>
          </div>

          <div class="row-2">
            <div class="form-row">
              <label>Bug Type</label>
              <select name="bug_type">
                <option value="functional">Something doesn&apos;t work</option>
                <option value="display">Something looks wrong</option>
                <option value="performance">It&apos;s very slow</option>
                <option value="data">Wrong data shown</option>
                <option value="payment">Payment issue</option>
                <option value="access">Can&apos;t access / permission denied</option>
                <option value="crash">Page crashed / error screen</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div class="form-row">
              <label>How often does it happen?</label>
              <select name="frequency">
                <option value="always">Every time</option>
                <option value="often" selected>Often</option>
                <option value="sometimes">Sometimes</option>
                <option value="once">Only happened once</option>
              </select>
            </div>
          </div>

          <div class="row-2">
            <div class="form-row">
              <label>Browser</label>
              <select name="browser">
                <option value="">Unknown</option>
                <option>Chrome</option>
                <option>Firefox</option>
                <option>Safari</option>
                <option>Edge</option>
                <option>Samsung Internet</option>
                <option>Other</option>
              </select>
            </div>
            <div class="form-row">
              <label>Device</label>
              <select name="device">
                <option value="">Unknown</option>
                <option>Desktop / Laptop</option>
                <option>iPhone</option>
                <option>Android Phone</option>
                <option>iPad / Tablet</option>
              </select>
            </div>
          </div>

          <div style="display:flex">
            <button type="button" class="btn btn-back" onclick="history.back()">&#8592; Back</button>
            <button type="submit" class="btn btn-primary" style="flex:1">Next &rarr;</button>
          </div>
        </form>

      <!-- ── Step 3: Detailed description ── -->
      <?php elseif ($step === 3): ?>
        <form method="POST">
          <input type="hidden" name="step" value="3"/>
          <?php
          $pass = ['project_id','reporter_name','reporter_email','bug_type','frequency','browser','device'];
          foreach ($pass as $k):
            $val = $_POST[$k] ?? '';
          ?>
            <input type="hidden" name="<?= htmlspecialchars($k) ?>" value="<?= htmlspecialchars($val) ?>"/>
          <?php endforeach; ?>

          <?php
          // Handle affected area: either radio or other text
          $affectedArea = !empty($_POST['affected_area']) ? $_POST['affected_area'] : ($_POST['affected_area_other'] ?? '');
          ?>
          <input type="hidden" name="affected_area" value="<?= htmlspecialchars($affectedArea) ?>"/>

          <div class="form-row">
            <label>How severe is this? <span class="req">*</span></label>
            <select name="severity" required>
              <option value="low">Low &mdash; Minor visual issue, workaround exists</option>
              <option value="medium" selected>Medium &mdash; Feature broken but I can continue</option>
              <option value="high">High &mdash; Core feature broken, major impact</option>
              <option value="critical">Critical &mdash; Cannot use the product at all</option>
            </select>
          </div>

          <div class="form-row">
            <label>Describe what&apos;s happening <span class="req">*</span></label>
            <textarea name="description" rows="4" required placeholder="Tell us exactly what you see or experience..."><?= htmlspecialchars($_POST['description'] ?? '') ?></textarea>
          </div>

          <div class="form-row">
            <label>Steps to reproduce</label>
            <textarea name="steps_to_reproduce" rows="3" placeholder="1. Go to...&#10;2. Click on...&#10;3. See error..."><?= htmlspecialchars($_POST['steps_to_reproduce'] ?? '') ?></textarea>
            <div class="hint">Step-by-step instructions help us find and fix the bug faster.</div>
          </div>

          <div class="row-2">
            <div class="form-row">
              <label>What did you expect?</label>
              <textarea name="expected_behavior" rows="2" placeholder="I expected the form to submit..."><?= htmlspecialchars($_POST['expected_behavior'] ?? '') ?></textarea>
            </div>
            <div class="form-row">
              <label>What actually happened?</label>
              <textarea name="actual_behavior" rows="2" placeholder="Instead, the page showed an error..."><?= htmlspecialchars($_POST['actual_behavior'] ?? '') ?></textarea>
            </div>
          </div>

          <div style="display:flex">
            <button type="button" class="btn btn-back" onclick="history.back()">&#8592; Back</button>
            <button type="submit" class="btn btn-primary" style="flex:1">Submit Bug Report</button>
          </div>
        </form>
      <?php endif; ?>
    </div>
  <?php endif; ?>
</div>
</body>
</html>
