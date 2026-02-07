import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// API Key
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('❌ GEMINI_API_KEY bulunamadı!');
}

const genAI = new GoogleGenerativeAI(API_KEY || 'dummy');

// ✅ DOĞRU MODELLER (Google AI Studio)
const MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3-flash-preview'
];

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
    models: MODELS,
    timestamp: new Date().toISOString()
  });
});

// Root
app.get('/', (req, res) => {
  res.json({ 
    message: 'Furkan Senyuz AI Backend',
    status: 'running',
    version: '1.0.0'
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

    let lastError = null;

    // Modelleri sırayla dene
    for (const modelName of MODELS) {
      try {
        console.log(`🤖 Denenen: ${modelName}`);
        
        const model = genAI.getGenerativeModel({ 
          model: modelName,
          generationConfig: {
            temperature: 0.9,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 2048,
          }
        });

        const result = await model.generateContent(SYSTEM_PROMPT + message);
        const response = await result.response;
        
        console.log(`✅ Başarılı: ${modelName}`);
        
        return res.json({ 
          response: response.text(),
          model: modelName,
          timestamp: new Date().toISOString()
        });

      } catch (err) {
        console.error(`❌ ${modelName}: ${err.message}`);
        lastError = err;
        continue;
      }
    }

    // Hiçbir model çalışmadı
    throw new Error(`Tüm modeller başarısız: ${lastError?.message}`);

  } catch (error) {
    console.error('💥 Chat hatası:', error);
    res.status(500).json({ 
      error: 'Bir hata oluştu',
      details: error.message 
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint bulunamadı' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('⚠️ Hata:', err);
  res.status(500).json({ error: 'Sunucu hatası' });
});

// Server başlat
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════╗
║  🚀 Furkan Şenyüz AI Backend          ║
╠════════════════════════════════════════╣
║  Port: ${PORT}                              ║
║  API Key: ${API_KEY ? '✓' : '✗'}                       ║
║  Models: ${MODELS.length}                           ║
╚════════════════════════════════════════╝
  `);
  console.log(`📦 Modeller:`);
  MODELS.forEach(m => console.log(`   - ${m}`));
});
