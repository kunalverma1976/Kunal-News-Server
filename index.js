const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

async function anthropicCall(messages, tools) {
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-search-2025-03-05'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 8000,
      tools: tools,
      messages: messages
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }
  return res.json();
}

async function runAgentLoop(userPrompt) {
  const tools = [{
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 10
  }];

  let messages = [{ role: 'user', content: userPrompt }];

  for (let turn = 0; turn < 15; turn++) {
    const data = await anthropicCall(messages, tools);

    messages.push({ role: 'assistant', content: data.content });

    if (data.stop_reason === 'end_turn') {
      const textBlock = data.content.find(b => b.type === 'text');
      if (!textBlock) throw new Error('No text in final response');
      return textBlock.text;
    }

    if (data.stop_reason === 'tool_use') {
      const toolResults = data.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content: 'Search completed.'
        }));

      if (toolResults.length > 0) {
        messages.push({ role: 'user', content: toolResults });
      }
      continue;
    }

    const textBlock = data.content.find(b => b.type === 'text');
    if (textBlock) return textBlock.text;
    throw new Error(`Unexpected stop_reason: ${data.stop_reason}`);
  }

  throw new Error('Agent loop exceeded maximum turns');
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/fetch-news', async (req, res) => {
  try {
    const { topic, isGlobalOnly } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic required' });

    const today = new Date().toDateString();
    let prompt;

    if (isGlobalOnly) {
      prompt = `Today is ${today}. You are a news researcher for a reader in India.

Search the web thoroughly and find the 20 most important RECENT global news stories about: "${topic}"

Focus on stories from the last 48 hours where possible. Cover diverse regions and angles.

Return ONLY a JSON array — no markdown fences, no preamble, no explanation. Each object must have exactly these fields:

[
  {
    "title": "Specific, informative headline",
    "summary": "2-3 sentence overview of what happened and why it matters",
    "detail": "A thorough 6-8 sentence detailed account of the story. Include: what happened, who is involved, the background context, why it matters globally, any reactions or consequences so far, and what might happen next.",
    "source": "Publication name",
    "scope": "global",
    "relevance": 88
  }
]

Return only the JSON array. 20 items. No other text.`;
    } else {
      prompt = `Today is ${today}. You are a news researcher for a reader based in Lucknow, Uttar Pradesh, India.

Search the web thoroughly and find 20 recent news stories about: "${topic}"

Split them as follows:
- 10 GLOBAL stories: the most important international developments on this topic
- 10 INDIA/LOCAL stories: stories specifically relevant to India, Uttar Pradesh, or Lucknow on this topic. Include state government actions, local industry news, UP-specific developments, and stories that directly affect people in Lucknow.

Return ONLY a JSON array — no markdown fences, no preamble, no explanation. Each object must have exactly these fields:

[
  {
    "title": "Specific, informative headline",
    "summary": "2-3 sentence overview of what happened and why it matters",
    "detail": "A thorough 6-8 sentence detailed account of the story. Include: what happened, who is involved, the background context, why it matters (globally or locally), any reactions or consequences so far, and what might happen next.",
    "source": "Publication name",
    "scope": "global",
    "relevance": 85
  }
]

Use "scope": "global" for the 10 international stories and "scope": "india" for the 10 India/Lucknow stories.
Return only the JSON array. Exactly 20 items (10 global + 10 india). No other text.`;
    }

    const text = await runAgentLoop(prompt);

    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    const start = clean.indexOf('[');
    const end = clean.lastIndexOf(']');
    if (start === -1 || end === -1) throw new Error('No JSON array in response');

    const articles = JSON.parse(clean.slice(start, end + 1));
    res.json({ articles });

  } catch (err) {
    console.error('fetch-news error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
