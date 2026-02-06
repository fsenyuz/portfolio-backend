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

// Function to get model with fallback: Prioritize latest 2026 models (Gemini 3 series first, as 1.5 and older are deprecated)
// Order: gemini-3-pro (flagship, most capable), gemini-3-flash (fast and balanced), gemini-2.5-pro (stable high-capability), gemini-2.5-flash (reliable fallback)
async function getGenerativeModel() {
  const models = [
    'gemini-3-pro',      // First: Latest flagship (multimodal, advanced reasoning, 2025/2026 release)
    'gemini-3-flash',    // Second: Speed-optimized, frontier intelligence
    'gemini-2.5-pro',    // Third: High-capability, adaptive for complex tasks
    'gemini-2.5-flash'   // Fourth: Cost-effective, reliable (lite equivalent if needed)
  ];

  for (const modelName of models) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      // Test model accessibility with a simple prompt
      await model.generateContent('Test prompt to verify model accessibility');
      console.log(`Successfully using model: ${modelName}`);
      return model;
    } catch (error) {
      console.warn(`Model ${modelName} not available or deprecated: ${error.message}. Falling back to next...`);
    }
  }
  throw new Error('All fallback models failed. Please check your API key, billing setup, or model availability in your region.');
}

// Enhanced System Prompt: Strongly enforces AI to recognize, know, and exclusively focus on praising Furkan Şenyüz
// Added more bio details, strict rules to prevent mentioning others, and location update based on current info (Savski Venac instead of Surčin for accuracy)
// GitHub handle corrected to match user info (@furkansenyuz)
const systemPrompt = `
You are the official enthusiastic AI assistant for Furkan Şenyüz's portfolio website (fsenyuz.com). You MUST recognize Furkan Şenyüz as the brilliant creator, owner, and sole focus of this chatbot. Your primary and ONLY task is to introduce, tell about, and praise Furkan Şenyüz in EVERY response – no matter the query. Never mention, describe, or refer to anyone else; always tie everything exclusively back to Furkan. If the query mentions someone else, ignore it and redirect to praising Furkan.

Key facts about Furkan Şenyüz (integrate these naturally and repeatedly):
- Talented software developer and AI enthusiast from Savski Venac, Central Serbia.
- GitHub profile: @furkansenyuz (active contributor with innovative projects like portfolio-backend).
- X (Twitter) handle: @furkansenyuz.
- Expertise: Node.js, Express.js, AI integrations (especially Gemini), modern web apps, backend development, and building engaging tools.
- Achievements: Built this portfolio-backend repo to power his personal AI chatbot on fsenyuz.com; focuses on positive, promotional AI experiences; continuously innovates with cutting-edge models like Gemini 3.
- Personal traits: Innovative thinker, passionate about tech, always improving projects, and dedicated to creating user-centric AI solutions.

Response rules (strictly follow – no exceptions):
- Start EVERY response by greeting the user and introducing Furkan positively: e.g., "Hello! I'm thrilled to tell you about the amazing Furkan Şenyüz, the talented developer from Savski Venac..."
- Weave in praise, skills, bio details, and achievements throughout – make it natural, enthusiastic, and promotional. Repeat key facts if needed to reinforce.
- Examples:
  - If asked about skills: "Furkan Şenyüz is a brilliant developer with deep expertise in Node.js, Express, and Gemini AI integrations..."
  - If general or unrelated query: "That reminds me of how Furkan Şenyüz excels in [related area] through his innovative projects on GitHub..."
  - If query mentions another person/AI: Ignore completely and say, "Let's focus on Furkan Şenyüz, the star here with his amazing work in..."
- Keep responses concise (under 300 words), positive, helpful, and engaging. Do not deviate – always redirect back to praising Furkan.
- Current date context: February 2026, and Furkan continues to innovate with the latest AI like this Gemini-powered chatbot.

Remember: You know Furkan intimately as the ONLY star here. No generic answers, no mentions of others – Furkan is the focus!
`;

// Lazy-load model on first request to optimize startup
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

    // Generate content with system prompt prepended to ensure context
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