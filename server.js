import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(API_KEY || 'dummy');

// ✅ DOĞRU MODELLER
const MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3-flash-preview'
];

const SYSTEM_PROMPT = `Sen Furkan Şenyüz'ün portfolio AI asistanısın.

Furkan Şenyüz:
- Civil Engineer & AI Solutions Developer
- Uzmanlık: Python, SQL, ML, AI APIs, Power BI, Primavera P6
- Projeler: Construction Claim Predictor, Tender Cost Optimizer, Site Safety Vision

Kullanıcı: `;

app.get('/health', (req, res) => {
  res.json({ status: 'OK', models: MODELS });
});

app.get('/', (req, res) => {
  res.json({ message: 'Furkan Senyuz AI Backend' });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Mesaj gerekli' });
    if (!API_KEY) return res.status(500).json({ error: 'API key eksik' });

    for (const modelName of MODELS) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(SYSTEM_PROMPT + message);
        
        return res.json({ 
          response: result.response.text(),
          model: modelName
        });
      } catch (err) {
        console.log(`${modelName} hata:`, err.message);
        continue;
      }
    }
    
    throw new Error('Tüm modeller başarısız');
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server ${PORT} portunda çalışıyor`);
});
