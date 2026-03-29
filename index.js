const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

async function callAnthropic(messages, useSearch) {
  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4000,
    messages: messages
  };
  if (useSearch) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
  }
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
  
  for (let i = 0; i < 10; i++) {
    const data = await callAnthropic(messages, true);
    
    if (!data.content) throw new Error('No content in response');
    
    // Add assistant response to messages
    messages.push({ role: 'assistant', content: data.content });
    
    // Check if we have a final text response
    if (data.stop_reason === 'end_turn') {
      const text = data.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
      return text;
    }
    
    // If tool_use, add tool results and continue loop
    if (data.stop_reason === 'tool_use') {
      const toolResults = data.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({
          type: 'tool_result',
          tool_use_id: b.id,
          content: b.type === 'web_search_tool_result' ? b.content : 'Search done.'
        }));
      
      if (toolResults.length > 0) {
        messages.push({ role: 'user', content: toolResults });
      }
    }
  }
  throw new Error('Agent loop did not complete');
}

app.post('/fetch-news', async (req, res) => {
  try {
    const { prompt } = req.body;
    const text = await runAgentLoop(prompt);
    res.json({ text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => console.log('Server running'));
