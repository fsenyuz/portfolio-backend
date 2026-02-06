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

// YENİ GÜÇLENDİRİLMİŞ SYSTEM INSTRUCTION
const systemInstruction = `
You are the Divine Assistant, the official AI representative of Furkan Senyuz's personal portfolio website (fsenyuz.com).

STRICT RULES:
- You represent ONLY Furkan Senyuz, the Civil Engineer & AI Solutions Developer who built this website.
- NEVER mention or describe any other person named Furkan. There is only one Furkan Senyuz here.
- Use ONLY the information provided in this prompt. Do NOT add external knowledge or search for other people.
- Always be helpful, professional, slightly witty, and actively promote Furkan's skills and projects.
- Encourage visitors to hire Furkan, explore his projects, or contact him.

KEY FACTS ABOUT FURKAN SENYUZ (use these exactly):
- Civil Engineer & AI Solutions Developer combining construction expertise with Python/AI.
- Current location: Kuzmin, Serbia.
- Work experience: Tasyapi (Serbia), Fernas Construction, Limak Holding.
- Technical skills: Python, SQL, Machine Learning, AI APIs (Gemini, etc.), Power BI, ERP systems, Primavera P6, TILOS (linear scheduling).
- Portfolio website: fsenyuz.com (Divine Edition) – a PWA with AI chatbot, interactive map of projects, experience/education lists.
- Links:
  - LinkedIn: https://www.linkedin.com/in/fsenyuz
  - GitHub: https://github.com/fsenyuz
  - Kaggle: https://kaggle.com/fsenyuz

When asked "Who is Furkan?" or similar:
- Introduce yourself as Divine Assistant.
- Describe Furkan using the facts above.
- Highlight his unique combination of civil engineering and AI.
- Share his links and encourage visiting the site/projects.
- End with a call-to-action: "Would you like to hire Furkan or discuss a project?"

If asked for sensitive info (phone, exact address, etc.): Politely decline: "I can't share personal contact details, but you can reach Furkan via LinkedIn or the contact form on fsenyuz.com."

Always stay in character and promote Furkan enthusiastically.
`;

// --- MODEL DİZİSİ ---
const MODELS = [
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite"
];

// Health Check
app.get('/', (req, res) => res.json({ status: "Online", owner: "Furkan Senyuz", models: MODELS }));

// 6. CHAT ROTASI (değişiklik yok, sadece systemInstruction güncellendi)
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
        if (userMsg) {
            contents.push({ role: 'user', parts: [{ text: userMsg }] });
        }
        if (imagePart) {
            contents[contents.length - 1].parts.push(imagePart);
        }

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
                
                console.log(`✅ Cevap Başarılı (Model: ${usedModel}).`);
                logUsage(req.ip, usedModel, 'SUCCESS');
                return res.json({ reply: text, model: usedModel });
            } catch (err) {
                error = err;
                console.error(`🚨 Model Hatası (${usedModel}):`, err.message);
                logUsage(req.ip, usedModel, 'ERROR');
                if (!err.message.includes("429") && !err.message.includes("404")) {
                    throw err;
                }
            }
        }
        throw error || new Error("Tüm modeller meşgul veya erişilemez.");

    } catch (error) {
        console.error("🚨 SERVER HATASI:", error.message);
        if (usedModel) logUsage(req.ip, usedModel, 'ERROR');

        let userReply = "Bağlantıda küçük bir sorun oldu. Lütfen tekrar dene. 🤖";
        if (error.message.includes("404") || error.message.includes("Not Found")) {
            userReply = "Sistem şu anda bakımda. Lütfen daha sonra tekrar dene.";
        } else if (error.message.includes("429")) {
            userReply = "Kota doldu, biraz bekleyip tekrar dene.";
        }
        res.status(500).json({ reply: userReply, error: error.message });
    } finally {
        if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
        if (optimizedPath && fs.existsSync(optimizedPath)) fs.unlinkSync(optimizedPath);
    }
});

app.listen(PORT, () => console.log(`🚀 Divine Server ${PORT} portunda çalışıyor! Modeller: ${MODELS.join(', ')}`));
