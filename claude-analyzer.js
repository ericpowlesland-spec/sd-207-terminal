const Anthropic = require('@anthropic-ai/sdk');

let client;

function getClient() {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set in environment');
    client = new Anthropic({ apiKey });
  }
  return client;
}

async function analyzeBugReport(project, bug, components) {
  const anthropic = getClient();

  const componentContext = components && components.length > 0
    ? `\n\nProject components:\n${components.map(c => `- ${c.name} (${c.type}) [${c.status}]`).join('\n')}`
    : '';

  const prompt = `You are a senior software engineer analyzing a bug report for a client project.

Project: ${project.name}
Category: ${project.category}
Description: ${project.description}${componentContext}

Bug Report:
- Affected Area: ${bug.affected_area}
- Type: ${bug.bug_type || 'Unknown'}
- Severity: ${bug.severity}
- Frequency: ${bug.frequency}
- Reporter: ${bug.reporter_name} (${bug.reporter_email || 'no email'})
- Browser/Device: ${[bug.browser, bug.device].filter(Boolean).join(' / ') || 'Not specified'}

Description:
${bug.description}

Steps to Reproduce:
${bug.steps_to_reproduce || 'Not provided'}

Expected Behavior:
${bug.expected_behavior || 'Not specified'}

Actual Behavior:
${bug.actual_behavior || 'Not specified'}

Please provide a structured analysis:

## Root Cause Assessment
Identify the most likely root cause(s) based on the symptoms described.

## Affected Code Areas
List the specific files, modules, or system areas most likely involved.

## Suggested Fix
Provide a concrete, actionable fix with code examples if applicable.

## Testing Steps
Steps to verify the fix resolves the issue.

## Priority
Confirm or adjust the severity rating and explain why.

Keep your response focused, technical, and actionable. The team is small, so prioritize the fastest path to resolution.`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }]
  });

  return message.content[0].text;
}

async function suggestComponentMatch(bugDescription, components) {
  if (!components || components.length === 0) return null;
  const anthropic = getClient();

  const prompt = `Given this bug description: "${bugDescription}"

And these project components:
${components.map((c, i) => `${i + 1}. ${c.name} (${c.type}) - ${c.description || 'no description'}`).join('\n')}

Which component number is most likely responsible for this bug? Reply with ONLY the number or "none" if unclear.`;

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 10,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = message.content[0].text.trim();
  const num = parseInt(text, 10);
  if (!isNaN(num) && num >= 1 && num <= components.length) {
    return components[num - 1];
  }
  return null;
}

module.exports = { analyzeBugReport, suggestComponentMatch };
