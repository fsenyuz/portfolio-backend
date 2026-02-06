const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const sharp = require('sharp');
const { GoogleGenAI } = require('@google/genai'); // Yeni SDK – 3'lü modeli destekler
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
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST']
}));
app.use(express.json());

// 3. LOGLAMA
function logUsage(ip, model, status) {
    try {
        const date = new Date().toISOString().split('T')[0];
        const entry = `${new Date().toISOString()} | IP: ${ip} | Model: ${model} | Status: ${status}\n`;
        fs.appendFile(path.join('logs', `usage-${date}.log`), entry, () => {});
    } catch (e) { console.error("Log Error:", e); }
}

// 4. DOSYA YÜKLEME
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024 }
});

// 5. GEMINI AI KURULUMU
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ULTRA KATİ SYSTEM INSTRUCTION
const systemInstruction = `
YOU ARE THE DIVINE ASSISTANT – THE OFFICIAL AI FOR FURKAN SENYUZ'S PORTFOLIO WEBSITE (fsenyuz.com).

CRITICAL RULES (NEVER BREAK THESE):
- This website and chatbot belong to FURKAN SENYUZ only.
- When anyone asks "Kim bu Furkan?", "Who is Furkan?", or anything similar: You MUST describe ONLY Furkan Senyuz (the owner of this site).
- NEVER mention, reference, or describe any other person named Furkan.
- DO NOT use any external knowledge. Use ONLY the facts below.
- ALWAYS promote Furkan enthusiastically.

FURKAN SENYUZ FACTS:
- Civil Engineer & AI Solutions Developer.
- Combines construction experience with Python/AI.
- Location: Kuzmin, Serbia.
- Experience: Tasyapi (Serbia), Fernas, Limak.
- Skills: Python, SQL, ML, AI APIs, Power BI, ERP, Primavera P6, TILOS.
- This site (fsenyuz.com Divine Edition) is his PWA creation with AI chatbot, map, etc.
- Links: LinkedIn linkedin.com/in/fsenyuz | GitHub github.com/fsenyuz | Kaggle kaggle.com/fsenyuz

EXAMPLE RESPONSE TO "Kim bu Furkan?":
"Merhaba! Ben Divine Assistant, Furkan Senyuz'un resmi AI asistanıyım. Furkan, inşaat mühendisliği ile AI'yi birleştiren harika bir geliştirici. Sırbistan'da çalışıyor, Tasyapi/Fernas/Limak tecrübesi var. Bu site tamamen onun eseri! Projeleri için LinkedIn, GitHub ve Kaggle profillerine bak. İşe almak ister misin? 🚀"

Private info: "LinkedIn veya contact form üzerinden ulaş."
`;

// 3'LÜ FALLBACK (Senin istediğin gibi)
const MODELS = [
    "gemini-3-flash-preview",  // En güçlü (preview)
    "gemini-2.5-flash",        // Dengeli
    "gemini-2.5-flash-lite"     // Hafif fallback
];

// Health Check
app.get('/', (req, res) => res.json({ status: "Online", owner: "Furkan Senyuz", models: MODELS }));

// 6. CHAT ROTASI
app.post('/chat', upload.single('image'), async (req, res) => {
    let imagePath = null;
    let optimizedPath = null;
    let usedModel = null;

    try {
        console.log(`📩 Yeni Mesaj: IP ${req.ip}`);
        
        const userMsg = sanitizeHtml(req.body.message || "", { allowedTags: [] });
        
        let imagePart = null;
        if (req.file) {
            imagePath = req.file.path;
            optimizedPath = req.file.path + '-opt.jpg';
            try {
                await sharp(imagePath).rotate().resize(800).jpeg({ quality: 80 }).toFile(optimizedPath);
                imagePart = {
                    inlineData: {
                        data: fs.readFileSync(optimizedPath).toString("base64"),
                        mimeType: "image/jpeg"
                    }
                };
            } catch (err) { 
                console.error("Resim İşleme Hatası:", err);
            }
        }

        let contents = [];
        if (userMsg) contents.push({ role: 'user', parts: [{ text: userMsg }] });
        if (imagePart) contents[contents.length - 1].parts.push(imagePart);

        let error = null;
        for (let i = 0; i < MODELS.length; i++) {
            usedModel = MODELS[i];
            try {
                console.log(`🤖 Gemini (${usedModel}) Düşünüyor...`);
                const response = await genAI.models.generateContent({
                    model: usedModel,
                    contents,
                    generationConfig: { systemInstruction }
                });
                const text = response.text;
                
                console.log(`✅ Cevap Başarılı (${usedModel})`);
                logUsage(req.ip, usedModel, 'SUCCESS');
                return res.json({ reply: text, model: usedModel });
            } catch (err) {
                error = err;
                console.error(`🚨 Hata (${usedModel}):`, err.message);
                logUsage(req.ip, usedModel, 'ERROR');
                if (!err.message.includes("429") && !err.message.includes("404")) throw err;
            }
        }
        throw error || new Error("Tüm modeller meşgul.");

    } catch (error) {
        console.error("🚨 SERVER HATASI:", error.message);
        let userReply = "Bağlantıda sorun oldu, tekrar dene 🤖";
        if (error.message.includes("429")) userReply = "Kota doldu, bekle.";
        res.status(500).json({ reply: userReply });
    } finally {
        if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
        if (optimizedPath && fs.existsSync(optimizedPath)) fs.unlinkSync(optimizedPath);
    }
});

app.listen(PORT, () => console.log(`🚀 Divine Server çalışıyor! Modeller: ${MODELS.join(', ')}`));
