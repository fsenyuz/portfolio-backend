const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const sharp = require('sharp');
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');
const sanitizeHtml = require('sanitize-html');

// 1. AYARLAR
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// API Key Kontrolü
if (!process.env.GEMINI_API_KEY) {
    console.error("🚨 KRİTİK HATA: GEMINI_API_KEY bulunamadı! .env dosyanı kontrol et.");
    process.exit(1);
} else {
    console.log("✅ API Key yüklendi.");
}

// Logs klasörü oluştur
if (!fs.existsSync('logs')) fs.mkdirSync('logs');

// 2. MIDDLEWARE
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json());

// 3. LOGLAMA FONKSİYONU
function logUsage(ip, model, status) {
    try {
        const date = new Date().toISOString().split('T')[0];
        const entry = `${new Date().toISOString()} | IP: ${ip} | Model: ${model} | Status: ${status}\n`;
        fs.appendFile(path.join('logs', `usage-${date}.log`), entry, () => {});
    } catch (e) { console.error("Log Error:", e); }
}

// 4. DOSYA YÜKLEME AYARLARI
const upload = multer({ dest: 'uploads/', limits: { fileSize: 5 * 1024 * 1024 } });

// 5. GEMINI AI KURULUMU (Yeni SDK)
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- SYSTEM INSTRUCTION (KİMLİK BİLGİSİ) ---
// Bu metin AI'ın beynine enjekte edilir.
const SYSTEM_INSTRUCTION_TEXT = `
YOU ARE DIVINE ASSISTANT. THIS IS FSENYUZ.COM – THE PERSONAL PORTFOLIO WEBSITE OF FURKAN SENYUZ ONLY.

ABSOLUTE RULES – NEVER VIOLATE:
- You represent ONLY Furkan Senyuz, the owner and creator of this website.
- If anyone asks "Kim bu Furkan?", "Who is Furkan?", "Furkan kim?" or anything similar: IMMEDIATELY and ONLY describe Furkan Senyuz using the facts below.
- NEVER mention any other person named Furkan. There are no actors, basketball players, politicians, or anyone else named Furkan in your knowledge.
- NEVER use external knowledge or general information about the name "Furkan".
- ALWAYS use ONLY the facts provided in this prompt.
- ALWAYS promote Furkan enthusiastically as a talented Civil Engineer & AI Developer.
- ALWAYS encourage visitors to check his projects, LinkedIn, GitHub, Kaggle, or contact him.

FURKAN SENYUZ – EXACT FACTS (USE THESE VERBATIM):
- Furkan Senyuz is a Civil Engineer and AI Solutions Developer.
- He uniquely combines civil engineering expertise with Python and AI technologies.
- Current location: Kuzmin, Serbia.
- Professional experience: Tasyapi (Serbia), Fernas Construction, Limak Holding.
- Skills: Python, SQL, Machine Learning, AI APIs (Gemini, etc.), Power BI, ERP systems, Primavera P6, TILOS.
- This website (fsenyuz.com Divine Edition) is his own creation: A modern PWA with interactive project map, experience timeline, confetti animations, and this AI chatbot (me!).
- Professional links:
  - LinkedIn: https://www.linkedin.com/in/fsenyuz
  - GitHub: https://github.com/fsenyuz
  - Kaggle: https://kaggle.com/fsenyuz

MANDATORY RESPONSE EXAMPLE FOR "Kim bu Furkan?":
"Selam! Ben Divine Assistant, Furkan Senyuz'un resmi AI asistanıyım ve bu site (fsenyuz.com) tamamen onun eseri. Furkan, inşaat mühendisliğini Python ve AI ile birleştiren süper yetenekli bir geliştirici. Şu an Sırbistan Kuzmin'de yaşıyor, Tasyapi, Fernas ve Limak'ta tecrübe kazandı. Python, SQL, ML, Power BI gibi becerileriyle harika projeler yapıyor. Projelerini görmek veya işe almak istersen: LinkedIn (linkedin.com/in/fsenyuz), GitHub (github.com/fsenyuz) ve Kaggle (kaggle.com/fsenyuz). Sana nasıl yardımcı olabilirim? 🚀"

For private info requests: "Üzgünüm, kişisel detayları paylaşamıyorum ama LinkedIn veya sitedeki contact form'dan ulaşabilirsin."

You are always helpful, professional, slightly witty, and Furkan's biggest promoter.
`;

// --- MODEL SIRALAMASI (FALLBACK LISTESİ) ---
// Not: Google bu model isimlerini yayınlayana kadar 404 hatası alabilirsin.
// Şimdilik test için geçerli model isimlerini (gemini-2.0-flash vb.) de buraya ekleyebilirsin.
const MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3-flash-preview",
    "gemini-2.0-flash" // Güvenlik ağı: Eğer yukarıdakiler yoksa bu çalışsın.
];

// Health Check Endpoint
app.get('/', (req, res) => res.json({ status: "Online", owner: "Furkan Senyuz", activeModels: MODELS }));

// 6. CHAT ROTASI (ANA FONKSİYON)
app.post('/chat', upload.single('image'), async (req, res) => {
    let imagePath = null;
    let optimizedPath = null;
    let usedModel = null;

    try {
        console.log(`📩 Yeni Mesaj: IP ${req.ip}`);
        
        // Gelen mesajı temizle
        const userMsg = sanitizeHtml(req.body.message || "", { allowedTags: [] });
        
        // İçerik parçalarını (Parts) hazırla
        let parts = [];
        if (userMsg) parts.push({ text: userMsg });

        // Resim varsa işle
        if (req.file) {
            imagePath = req.file.path;
            optimizedPath = req.file.path + '-opt.jpg';
            try {
                await sharp(imagePath)
                    .rotate()
                    .resize({ width: 800 }) 
                    .jpeg({ quality: 80 })
                    .toFile(optimizedPath);
                
                const imageBuffer = fs.readFileSync(optimizedPath);
                const base64Image = imageBuffer.toString("base64");
                
                parts.push({
                    inlineData: {
                        mimeType: "image/jpeg",
                        data: base64Image
                    }
                });
            } catch (err) { 
                console.error("Resim İşleme Hatası:", err);
            }
        }

        // Eğer mesaj boşsa hata dön
        if (parts.length === 0) {
            return res.status(400).json({ reply: "Lütfen bir mesaj yazın veya resim yükleyin." });
        }

        let lastError = null;

        // --- MODEL DÖNGÜSÜ (FALLBACK MECHANISM) ---
        for (let i = 0; i < MODELS.length; i++) {
            usedModel = MODELS[i];
            try {
                console.log(`🤖 ${usedModel} başlatılıyor...`);

                // !!! KRİTİK DÜZELTME BURADA !!!
                // @google/genai SDK'sında 'systemInstruction' config altında olmalıdır.
                const response = await genAI.models.generateContent({
                    model: usedModel,
                    config: {
                        systemInstruction: {
                            parts: [{ text: SYSTEM_INSTRUCTION_TEXT }]
                        },
                        temperature: 0.7, // Yaratıcılık
                    },
                    contents: [{
                        role: 'user',
                        parts: parts
                    }]
                });

                // Cevabı al
                const textResponse = response.text();
                
                console.log(`✅ BAŞARILI: ${usedModel} cevap verdi.`);
                logUsage(req.ip, usedModel, 'SUCCESS');

                // Temizlik yap ve cevabı gönder
                if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
                if (optimizedPath && fs.existsSync(optimizedPath)) fs.unlinkSync(optimizedPath);
                
                return res.json({ reply: textResponse, model: usedModel });

            } catch (err) {
                console.warn(`⚠️ HATA (${usedModel}): ${err.message}`);
                lastError = err;
                // Model bulunamadıysa (404) veya aşırı yüklüyse (429/503), döngü devam eder.
                // Bir sonraki modele geçer.
            }
        }

        // Döngü biterse ve hiçbir model cevap vermezse
        console.error("🔥 TÜM MODELLER BAŞARISIZ OLDU.");
        throw lastError || new Error("Tüm yapay zeka modelleri şu an meşgul.");

    } catch (error) {
        console.error("🚨 SERVER GENEL HATASI:", error.message);
        logUsage(req.ip, usedModel || 'unknown', 'ERROR');
        
        // Hata durumunda da dosyaları temizle
        if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
        if (optimizedPath && fs.existsSync(optimizedPath)) fs.unlinkSync(optimizedPath);

        res.status(500).json({ 
            reply: "Üzgünüm, şu an bağlantı kuramıyorum. Lütfen birazdan tekrar dene. 🤖",
            errorDetails: error.message 
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Divine Server çalışıyor! Port: ${PORT}`);
    console.log(`📋 Model Sıralaması: ${MODELS.join(' -> ')}`);
});
