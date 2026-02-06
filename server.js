const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const sharp = require('sharp');
// DİKKAT: Google'ın yeni Unified SDK'sı
const { GoogleGenAI } = require("@google/genai"); 
const fs = require('fs');
const path = require('path');
const sanitizeHtml = require('sanitize-html');

// --- 1. AYARLAR & GÜVENLİK ---
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// API Key Kontrolü
if (!process.env.GEMINI_API_KEY) {
    console.error("🚨 KRİTİK HATA: .env dosyasında GEMINI_API_KEY eksik!");
    // Render deploy sırasında çökmemesi için sadece uyarı veriyoruz, ama chat çalışmaz.
    // process.exit(1); 
}

// Log Klasörü Kontrolü
if (!fs.existsSync('logs')) fs.mkdirSync('logs');

// --- 2. MIDDLEWARE ---
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json());

// --- 3. YARDIMCI FONKSİYONLAR ---
function logUsage(ip, model, status) {
    try {
        const date = new Date().toISOString().split('T')[0];
        const entry = `${new Date().toISOString()} | IP: ${ip} | Model: ${model} | Status: ${status}\n`;
        fs.appendFile(path.join('logs', `usage-${date}.log`), entry, () => {});
    } catch (e) { console.error("Log hatası:", e); }
}

const upload = multer({ dest: 'uploads/', limits: { fileSize: 5 * 1024 * 1024 } });

// --- 4. GEMINI KURULUMU (YENİ SDK) ---
// KRİTİK: apiVersion 'v1' olarak ayarlandı (v1beta hatalarını çözer)
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, apiVersion: 'v1' });

// --- 5. PERSONA (DİVİNE ASSISTANT KİMLİĞİ) ---
const SYSTEM_INSTRUCTION_TEXT = `
YOU ARE DIVINE ASSISTANT. THIS IS FSENYUZ.COM – THE PERSONAL PORTFOLIO WEBSITE OF FURKAN SENYUZ ONLY.

ABSOLUTE RULES – NEVER VIOLATE:
- You represent ONLY Furkan Senyuz.
- If anyone asks "Kim bu Furkan?", "Who is Furkan?": IMMEDIATELY describe Furkan Senyuz using the facts below.
- NEVER mention any other person named Furkan.
- ALWAYS promote Furkan enthusiastically as a Civil Engineer & AI Developer.

FURKAN SENYUZ – EXACT FACTS:
- **Role:** Civil Engineer and AI Solutions Developer.
- **Location:** Kuzmin, Serbia.
- **Experience:** Tasyapi (Serbia), Fernas Construction, Limak Holding.
- **Skills:** Python, SQL, Machine Learning, Gemini AI, Power BI, Primavera P6.
- **This Website:** A modern PWA developed by him.
- **Links:** LinkedIn (linkedin.com/in/fsenyuz), GitHub (github.com/fsenyuz).

MANDATORY RESPONSE STYLE:
Be helpful, professional, slightly witty. Answer in the language the user speaks (Turkish or English).
`;

// --- 6. MODEL LİSTESİ (FALLBACK MECHANISM - SENİN AI STUDIO ERİŞİMİNE GÖRE MİNİMİZE) ---
// Başa çalışan modeller: Gemini 3 Flash, 2.5 Flash, 2.5 Flash Lite. Diğerleri fallback.
const MODELS = [
    "gemini-3-flash",            // Senin listende Gemini 3 Flash (çalışmalı)
    "gemini-2.5-flash",          // Gemini 2.5 Flash
    "gemini-2.5-flash-lite",     // Gemini 2.5 Flash Lite
    "gemini-2.5-flash-tts",      // TTS varyantı (metin için dener)
    "gemma-3-27b",               // Gemma 3 27B (açık kaynak fallback)
    "gemma-3-12b"                // Hafif Gemma fallback
];

// Health Check (Versiyon kontrolü eklendi)
app.get('/', (req, res) => res.json({ 
    status: "Divine AI Online", 
    version: "2026.02-final-fix2", 
    models: MODELS 
}));

// --- 7. CHAT ROTASI ---
app.post('/chat', upload.single('image'), async (req, res) => {
    let imagePath = null;
    let optimizedPath = null;
    let usedModel = null;

    try {
        // IP Adresini Güvenli Alma (Proxy arkasında ise x-forwarded-for)
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        console.log(`📩 İstek Geldi: ${clientIp}`);

        // Mesajı Temizle
        const userMsg = sanitizeHtml(req.body.message || "", { allowedTags: [] });
        
        // Prompt Parçalarını Oluştur (System instruction'ı user prompt'una enjekte et - role destek sorunu için)
        const combinedPrompt = SYSTEM_INSTRUCTION_TEXT + "\n\nUser Message: " + userMsg;
        const parts = [{ text: combinedPrompt }];

        // Resim İşleme
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
                parts.push({
                    inlineData: {
                        mimeType: "image/jpeg",
                        data: imageBuffer.toString("base64")
                    }
                });
            } catch (err) {
                console.error("Resim hatası:", err);
            }
        }

        if (parts.length === 0) return res.status(400).json({ reply: "Lütfen bir mesaj yazın." });

        let lastError = null;

        // --- MODEL DÖNGÜSÜ (FALLBACK) ---
        for (const modelName of MODELS) {
            usedModel = modelName;
            try {
                console.log(`🤖 Model deneniyor: ${modelName}`);

                // YENİ SDK SYNTAX: Sadece user role, system enjekte edildi (hataları çözer)
                const result = await genAI.models.generateContent({
                    model: modelName,
                    contents: [{ role: 'user', parts: parts }],
                    generationConfig: {
                        temperature: 0.5,  // Düşük: Stabilite
                        maxOutputTokens: 500  // Düşük: Rate limit için
                    }
                });

                // ROBUST CEVAP ÇIKARMA
                let responseText = '';
                if (typeof result.text === 'function') {
                    responseText = result.text();
                } else if (result.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
                    responseText = result.response.candidates[0].content.parts[0].text;
                } else {
                    throw new Error("Boş cevap döndü.");
                }

                console.log(`✅ BAŞARILI: ${modelName}`);
                logUsage(clientIp, modelName, 'SUCCESS');

                // Temizlik
                if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
                if (optimizedPath && fs.existsSync(optimizedPath)) fs.unlinkSync(optimizedPath);

                return res.json({ reply: responseText, model: modelName });

            } catch (err) {
                console.warn(`⚠️ HATA (${modelName}): ${err.message}`);
                lastError = err;
                // Sıradaki modele geç...
            }
        }

        throw lastError || new Error("Tüm modeller meşgul.");

    } catch (error) {
        console.error("🚨 SERVER HATASI:", error.message);
        logUsage(req.headers['x-forwarded-for'] || 'unknown', 'ALL_FAILED', 'ERROR');

        if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
        if (optimizedPath && fs.existsSync(optimizedPath)) fs.unlinkSync(optimizedPath);

        res.status(500).json({ reply: "Bağlantı şu an kurulamadı. (Hata: Modeller yanıt vermiyor)" });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Divine Server (Unified SDK) Yayında! Port: ${PORT}`);
    console.log(`📋 Model Sıralaması: ${MODELS.join(' -> ')}`);
});
