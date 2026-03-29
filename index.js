const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

app.post('/fetch-news', async (req, res) => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();

    // If web search is being used, Anthropic may stop mid-way
    // and need a follow-up message to get the final text response
    if (data.stop_reason === 'tool_use') {
      // Build follow-up conversation with tool results included
      const followUp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: req.body.model,
          max_tokens: req.body.max_tokens,
          tools: req.body.tools,
          messages: [
            ...req.body.messages,
            { role: 'assistant', content: data.content },
            {
              role: 'user',
              content: data.content
                .filter(b => b.type === 'tool_use')
                .map(b => ({
                  type: 'tool_result',
                  tool_use_id: b.id,
                  content: 'Search completed. Now compile your findings into the JSON array as instructed.'
                }))
            }
          ]
        })
      });
      const finalData = await followUp.json();
      return res.json(finalData);
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 3000, () => console.log('Server running'));
