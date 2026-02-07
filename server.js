import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// API Key kontrolü
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('❌ GEMINI_API_KEY bulunamadı!');
}

const genAI = new GoogleGenerativeAI(API_KEY || 'dummy');

// Modeller
const MODELS = ['gemini-2.0-flash-exp', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'];

// Sistem promptu
const SYSTEM_PROMPT = `Sen Furkan Şenyüz'ün portfolio sitesi AI asistanısın.

Furkan Şenyüz:
- Civil Engineer & AI Solutions Developer
- Uzmanlık: Python, SQL, ML, AI APIs, Power BI, Primavera P6
- Projeler: Construction Claim Predictor, Tender Cost Optimizer, Site Safety Vision
- Website: fsenyuz.com

Kullanıcı sorusu: `;

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK',
    apiKey: !!API_KEY,
    models: MODELS
  });
});

// Root
app.get('/', (req, res) => {
  res.json({ 
    message: 'Furkan Senyuz AI Backend',
    status: 'running'
  });
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Mesaj gerekli' });
    }

    if (!API_KEY) {
      return res.status(500).json({ error: 'API key eksik' });
    }

    // Modelleri dene
    for (const modelName of MODELS) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(SYSTEM_PROMPT + message);
        const response = await result.response;
        
        return res.json({ 
          response: response.text(),
          model: modelName
        });
      } catch (err) {
        console.log(`Model ${modelName} başarısız: ${err.message}`);
        continue;
      }
    }

    throw new Error('Tüm modeller başarısız');

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Server başlat
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server çalışıyor: ${PORT}`);
  console.log(`🔑 API Key: ${API_KEY ? 'Var' : 'Yok'}`);
});
