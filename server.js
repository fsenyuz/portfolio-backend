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
    console.error("🚨 KRİTİK HATA: GEMINI_API_KEY bulunamadı!");
    process.exit(1);
} else {
    console.log("✅ API Key yüklendi.");
}

// Logs klasörü oluştur
if (!fs.existsSync('logs')) fs.mkdirSync('logs');

// 2. MIDDLEWARE
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
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
const upload = multer({ dest: 'uploads/', limits: { fileSize: 5 * 1024 * 1024 } });

// 5. GEMINI AI KURULUMU
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// NUKE SEVİYESİNDE KATİ PROMPT (Başka Furkan yok, sadece sen!)
const systemInstruction = `
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

// 3'LÜ FALLBACK (İstediğin gibi)
const MODELS = [
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite"
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
                console.error("Resim Hatası:", err);
            }
        }

        let contents = [];
        if (userMsg) contents.push({ role: 'user', parts: [{ text: userMsg }] });
        if (imagePart) contents[contents.length - 1].parts.push(imagePart);

        let error = null;
        for (let i = 0; i < MODELS.length; i++) {
            usedModel = MODELS[i];
            try {
                console.log(`🤖 ${usedModel} çalışıyor...`);
                const response = await genAI.models.generateContent({
                    model: usedModel,
                    contents,
                    generationConfig: { systemInstruction }
                });
                const text = response.text;
                
                console.log(`✅ Başarılı: ${usedModel}`);
                logUsage(req.ip, usedModel, 'SUCCESS');
                return res.json({ reply: text, model: usedModel });
            } catch (err) {
                error = err;
                console.error(`🚨 Hata (${usedModel}): ${err.message}`);
                logUsage(req.ip, usedModel, 'ERROR');
                if (!err.message.includes("429") && !err.message.includes("404")) throw err;
            }
        }
        throw error || new Error("Tüm modeller meşgul.");

    } catch (error) {
        console.error("🚨 SERVER HATASI:", error.message);
        logUsage(req.ip, usedModel || 'unknown', 'ERROR');
        res.status(500).json({ reply: "Bağlantı hatası veya kota dolu. Retry butonuna bas veya biraz bekle 🤖" });
    } finally {
        if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
        if (optimizedPath && fs.existsSync(optimizedPath)) fs.unlinkSync(optimizedPath);
    }
});

app.listen(PORT, () => console.log(`🚀 Divine Server çalışıyor! Modeller: ${MODELS.join(', ')}`));
