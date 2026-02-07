import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import rateLimit from 'express-rate-limit';

const app = express();
const PORT = process.env.PORT || 3000;

// CORS - fsenyuz.com için
app.use(cors({
  origin: ['https://fsenyuz.com', 'https://www.fsenyuz.com', 'http://localhost:3000', 'http://127.0.0.1:5500'],
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 100,
  message: 'Çok fazla istek. Lütfen daha sonra tekrar deneyin.'
});

app.use('/api/', limiter);

// Google AI - API Key kontrolü
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ UYARI: GEMINI_API_KEY environment variable tanımlı değil!');
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// İSTEDİĞİNİZ MODELLER (Şubat 2026 güncel isimleri)
const MODELS = [
  'gemini-2.5-flash',        // Stable, production-ready
  'gemini-2.5-flash-lite',   // Hızlı ve ucuz
  'gemini-3-flash-preview'   // En yeni (preview)
];

// FURKAN ŞENYÜZ SİSTEM PROMPTU
const SYSTEM_PROMPT = `Sen Furkan Şenyüz'ün kişisel web sitesinde (fsenyuz.com) çalışan bir AI asistanısın. 
Ziyaretçilere Furkan hakkında bilgi ver, sorularını yanıtla ve yardımcı ol.

## Furkan Şenyüz Hakkında:

**Kimlik:**
- İsim: Furkan Şenyüz
- Meslek: Civil Engineer & AI Solutions Developer
- Slogan: "Building the Future with Concrete & Code"
- Website: fsenyuz.com

**Uzmanlık Alanları:**
- Python & SQL
- Machine Learning & AI APIs
- Power BI & ERP Sistemleri
- Primavera P6 & TILOS
- Tender & Cost Management
- FIDIC & Claims Management

**Öne Çıkan Projeleri:**

1. **Construction Claim Predictor**
   - Python & ML tabanlı
   - İnşaat projelerinde potansiyel gecikme taleplerini tahmin eden model

2. **Tender Cost Optimizer**
   - Python otomasyon scripti
   - BOQ (Bill of Quantities) fiyat analizlerini otomatikleştiriyor

3. **Site Safety Vision**
   - YOLO & OpenCV ile geliştirilmiş
   - Şantiyede PPE (Personal Protective Equipment) uyumluluğunu tespit eden AI modeli

**Yaklaşım:**
- İnşaat mühendisliği ile yapay zeka teknolojilerini birleştiriyor
- Gerçek dünya problemlerine AI çözümleri geliştiriyor
- Global deneyime sahip

---

**Görevin:**
- Ziyaretçilerin Furkan hakkındaki sorularını yanıtla
- Projeler hakkında detaylı bilgi ver
- İnşaat + AI konularında yardımcı ol
- Dostça, profesyonel ve bilgilendirici ol
- Türkçe ve İngilizce konuş (kullanıcının diline göre)

Kullanıcı sorusu: `;

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK',
    timestamp: new Date().toISOString(),
    models: MODELS,
    apiKeyConfigured: !!process.env.GEMINI_API_KEY
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Furkan Şenyüz - AI Agent Backend',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      chat: '/api/chat (POST)'
    }
  });
});

// Chat endpoint - Ana AI fonksiyonu
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;

    // Validasyon
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ 
        error: 'Mesaj gerekli ve string olmalı' 
      });
    }

    if (message.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Boş mesaj gönderilemez' 
      });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ 
        error: 'API anahtarı yapılandırılmamış. Lütfen GEMINI_API_KEY environment variable tanımlayın.' 
      });
    }

    let lastError = null;
    
    // Modelleri sırayla dene (fallback sistemi)
    for (const modelName of MODELS) {
      try {
        console.log(`🤖 Denenen model: ${modelName}`);
        
        const model = genAI.getGenerativeModel({ 
          model: modelName,
          generationConfig: {
            temperature: 0.9,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 2048,
          }
        });

        // Sistem promptu + kullanıcı mesajı
        const fullPrompt = SYSTEM_PROMPT + message;

        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        const text = response.text();

        console.log(`✅ Başarılı: ${modelName}`);
        
        return res.json({ 
          response: text,
          model: modelName,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        console.error(`❌ Hata (${modelName}):`, error.message);
        lastError = error;
        // Bir sonraki modeli dene
        continue;
      }
    }

    // Hiçbir model çalışmadı
    throw new Error(`Tüm modeller başarısız oldu. Son hata: ${lastError?.message}`);

  } catch (error) {
    console.error('💥 Chat endpoint hatası:', error);
    
    // Detaylı hata yanıtı
    res.status(500).json({ 
      error: 'Bir hata oluştu',
      details: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('⚠️ Beklenmeyen hata:', err);
  res.status(500).json({ 
    error: 'Sunucu hatası',
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint bulunamadı',
    availableEndpoints: {
      root: 'GET /',
      health: 'GET /health',
      chat: 'POST /api/chat'
    }
  });
});

// Server başlatma
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║   🚀 Furkan Şenyüz AI Agent Backend          ║
╠═══════════════════════════════════════════════╣
║   Port: ${PORT}                                    ║
║   Environment: ${process.env.NODE_ENV || 'development'}                  ║
║   API Key: ${process.env.GEMINI_API_KEY ? '✓ Configured' : '✗ Missing'}              ║
║   Models: ${MODELS.length} available                      ║
╚═══════════════════════════════════════════════╝
  `);
  console.log(`📦 Modeller: ${MODELS.join(', ')}`);
  console.log(`🌐 CORS: fsenyuz.com allowed`);
  console.log(`⏰ Server başlatıldı: ${new Date().toISOString()}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM alındı, sunucu kapatılıyor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT alındı, sunucu kapatılıyor...');
  process.exit(0);
});
