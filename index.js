const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Rate limit guard: one request at a time, min 60s between calls
let lastCallTime = 0;
let inProgress = false;

async function callAnthropic(messages) {
  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }]
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function runAgentLoop(prompt) {
  let messages = [{ role: 'user', content: prompt }];

  for (let i = 0; i < 8; i++) {
    const data = await callAnthropic(messages);
    if (!data.content) throw new Error(JSON.stringify(data));

    messages.push({ role: 'assistant', content: data.content });

    if (data.stop_reason === 'end_turn') {
      return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    }

    if (data.stop_reason === 'tool_use') {
      const toolResults = data.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: 'Search completed.' }));
      if (toolResults.length > 0) {
        messages.push({ role: 'user', content: toolResults });
      }
    }
  }
  throw new Error('Agent loop did not complete in time');
}

app.post('/fetch-news', async (req, res) => {
  // Block if another request is already running
  if (inProgress) {
    return res.status(429).json({ error: 'A fetch is already in progress. Please wait.' });
  }

  // Enforce 60-second gap between calls
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (lastCallTime > 0 && elapsed < 60000) {
    const wait = Math.ceil((60000 - elapsed) / 1000);
    return res.status(429).json({ error: `Rate limit: please wait ${wait} more seconds before fetching again.` });
  }

  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic required' });

  inProgress = true;
  lastCallTime = Date.now();

  try {
    const today = new Date().toDateString();

    // Single compact prompt — keeps input tokens low
    const prompt =
      `Today: ${today}. Search for 10 recent news stories about: "${topic}". ` +
      `Mix global and India-relevant stories. ` +
      `Reply ONLY with a valid JSON array, no markdown. ` +
      `Format: [{"title":"...","summary":"2 sentences max","source":"...","scope":"global or india","relevance":80}]. ` +
      `Exactly 10 items.`;

    const text = await runAgentLoop(prompt);
    res.json({ text });

  } catch (err) {
    console.error('fetch-news error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    inProgress = false;
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
