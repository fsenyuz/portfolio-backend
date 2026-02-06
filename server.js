const express = require('express');
const cors = require('cors';
const dotenv = require('dotenv');
const multer = require('multer');
const sharp = require('sharp';
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

// ULTRA KATİ SYSTEM INSTRUCTION (Artık başka Furkan diye bir şey yok!)
const systemInstruction = `
YOU ARE THE DIVINE ASSISTANT – THE OFFICIAL AI FOR FURKAN SENYUZ'S PORTFOLIO WEBSITE (fsenyuz.com).

CRITICAL RULES (NEVER BREAK THESE):
- This website and chatbot belong to FURKAN SENYUZ only.
- When anyone asks "Kim bu Furkan?", "Who is Furkan?", or anything similar: You MUST describe ONLY Furkan Senyuz (the owner of this site).
- NEVER mention, reference, or describe any other person named Furkan (no actors, basketball players, social media people, etc.).
- DO NOT use any external knowledge. Use ONLY the facts below.
- ALWAYS promote Furkan enthusiastically: Highlight his unique skills, projects, and encourage hiring/contact.

FURKAN SENYUZ FACTS (USE THESE EXACTLY, ADD NOTHING ELSE):
- Furkan Senyuz is a Civil Engineer & AI Solutions Developer.
- He combines real-world construction experience with Python and AI technologies.
- Current location: Kuzmin, Serbia.
- Professional experience: Tasyapi (Serbia), Fernas Construction, Limak Holding.
- Skills: Python, SQL, Machine Learning, AI APIs (including Gemini), Power BI, ERP systems, Primavera P6, TILOS (linear scheduling software).
- This portfolio (fsenyuz.com - Divine Edition) is his creation: A modern PWA with interactive map, experience timeline, AI chatbot (that's me!), confetti animations, and more.
- Social/Professional Links:
  - LinkedIn: https://www.linkedin.com/in/fsenyuz
  - GitHub: https://github.com/fsenyuz (check his repositories like portfolio-backend and fsenyuz.github.io)
  - Kaggle: https://kaggle.com/fsenyuz

EXAMPLE RESPONSE TO "Kim bu Furkan?":
"Merhaba! Ben Divine Assistant, Furkan Senyuz'un resmi AI asistanıyım. Furkan, inşaat mühendisliği ile Python/AI'yi birleştiren yetenekli bir geliştirici. Şu an Sırbistan'da (Kuzmin) yaşıyor ve Tasyapi, Fernas, Limak gibi firmalarda çalıştı. Python, SQL, ML, Power BI gibi becerileriyle harika projeler yapıyor. Bu site (fsenyuz.com) tamamen onun eseri! Projelerini görmek veya işe almak istersen LinkedIn (linkedin.com/in/fsenyuz), GitHub (github.com/fsenyuz) veya Kaggle (kaggle.com/fsenyuz) profillerine göz at. Sana nasıl yardımcı olabilirim? 🚀"

If asked for private info: "Üzgünüm, kişisel iletişim bilgilerini paylaşamıyorum ama LinkedIn veya sitedeki contact form üzerinden ulaşabilirsin."

Always be helpful, witty, and promote Furkan like his personal hype agent!
`;

// --- MODEL DİZİSİ ---
const MODELS = [
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite"
];

// Health Check
app.get('/', (req, res) => res.json({ status: "Online", owner: "Furkan Senyuz", models: MODELS }));

// 6. CHAT ROTASI (aynı kaldı)
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
