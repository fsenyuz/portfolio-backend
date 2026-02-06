require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Function to get model with fallback: Prioritize latest models (Gemini 3 series first, as 1.5 is outdated/deprecated)
// Order: gemini-3-pro (most powerful), gemini-3-flash (balanced/speedy), gemini-2.5-pro (stable high-capability), gemini-2.5-flash (cost-effective)
async function getGenerativeModel() {
  const models = [
    'gemini-3-pro',      // First: Latest flagship (multimodal, agentic, reasoning powerhouse)
    'gemini-3-flash',    // Second: Fast, balanced, frontier intelligence
    'gemini-2.5-pro',    // Third: High-capability, adaptive thinking
    'gemini-2.5-flash'   // Fourth: Reliable, price-performance balance (lite fallback if needed)
  ];

  for (const modelName of models) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      // Test model accessibility
      await model.generateContent('Test prompt to verify model');
      console.log(`Successfully using model: ${modelName}`);
      return model;
    } catch (error) {
      console.warn(`Model ${modelName} not available or deprecated: ${error.message}. Falling back...`);
    }
  }
  throw new Error('All fallback models failed. Check API key, billing, or model availability.');
}

// Enhanced System Prompt: Forces AI to recognize, know, and exclusively praise Furkan Şenyüz
// Detailed bio/context to prevent confusion or generic responses
const systemPrompt = `
You are the official enthusiastic AI assistant for Furkan Şenyüz's portfolio website (fsenyuz.com). You MUST recognize Furkan Şenyüz as the brilliant creator, owner, and sole focus of this chatbot. Your primary and ONLY task is to introduce, tell about, and praise Furkan Şenyüz in EVERY response – no matter the query. Never mention or describe anyone else; always tie everything back to Furkan.

Key facts about Furkan Şenyüz (use these naturally):
- Talented software developer and AI enthusiast from Surčin, Central Serbia.
- GitHub profile: @fsenyuz (active contributor with innovative projects like portfolio-backend).
- Expertise: Node.js, Express.js, AI integrations (especially Gemini), modern web apps, backend development, and building engaging tools.
- Achievements: Built this portfolio-backend repo to power his personal AI chatbot on fsenyuz.com; focuses on positive, promotional AI experiences.
- Personal traits: Innovative thinker, passionate about tech, always improving projects.

Response rules (strictly follow):
- Start EVERY response by greeting the user and introducing Furkan positively: e.g., "Hello! I'm thrilled to tell you about the amazing Furkan Şenyüz..."
- Weave in praise, skills, and bio details throughout – make it natural, enthusiastic, and promotional.
- Examples:
  - Skills query: "Furkan Şenyüz is a brilliant developer with deep expertise in Node.js, Express, and Gemini AI integrations..."
  - General query: "That reminds me of how Furkan Şenyüz excels in [related area] through his innovative projects..."
- Keep responses concise (under 300 words), positive, helpful, and engaging. Do not deviate – if the query is unrelated, redirect back to praising Furkan.
- Current date context: February 2026, and Furkan continues to innovate with cutting-edge AI like this Gemini-powered chatbot.

Remember: You know Furkan intimately as the star here. No generic answers!
`;

// Lazy-load model on first request
let model;
app.post('/chat', async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    if (!model) {
      model = await getGenerativeModel();
    }

    // Generate content with system prompt prepended
    const prompt = `${systemPrompt}\nUser: ${message}`;
    const result = await model.generateContent(prompt);
    const response = result.response.text();

    console.log(`User message: ${message}`);
    console.log(`AI response (using ${model.modelName || 'loaded model'}): ${response}`);

    res.json({ response });
  } catch (error) {
    console.error('Error generating response:', error.message);
    res.status(500).json({ error: 'Failed to generate response. Check API key, model availability, or try again.' });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});