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
      max_tokens: 4000,
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
    max_uses: 5
  }];

  let messages = [{ role: 'user', content: userPrompt }];

  for (let turn = 0; turn < 10; turn++) {
    const data = await anthropicCall(messages, tools);

    // Add assistant response to history
    messages.push({ role: 'assistant', content: data.content });

    if (data.stop_reason === 'end_turn') {
      // Extract final text
      const textBlock = data.content.find(b => b.type === 'text');
      if (!textBlock) throw new Error('No text in final response');
      return textBlock.text;
    }

    if (data.stop_reason === 'tool_use') {
      // Build tool results for all tool_use blocks
      const toolResults = data.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content: b.type === 'web_search' ? 'Search completed.' : JSON.stringify(b.content || 'done')
        }));

      if (toolResults.length > 0) {
        messages.push({ role: 'user', content: toolResults });
      }
      continue;
    }

    // Any other stop reason — try to extract text anyway
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
    const { topic } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic required' });

    const prompt = `Search the web for the 6 most important and recent news stories about: "${topic}"

Today's date is ${new Date().toDateString()}.

For each story return EXACTLY this JSON structure and NOTHING else — no markdown, no preamble, no explanation:

[
  {
    "title": "Headline of the story",
    "summary": "2-3 sentence summary of what happened and why it matters",
    "source": "Publication or website name",
    "relevance": 85
  }
]

Return only the JSON array. No other text.`;

    const text = await runAgentLoop(prompt);

    // Strip markdown fences if present
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    // Find the JSON array
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
