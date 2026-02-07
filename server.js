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

// DİNAMİK JSON YÜKLEME (fsenyuz.com/data'dan çek – Render'da local kopya tut)
let siteFacts = '';
try {
    const dataPath = path.join(__dirname, 'data'); // Render'da data klasörü varsa
    const experience = JSON.parse(fs.readFileSync(path.join(dataPath, 'experience.json'), 'utf8'));
    const education = JSON.parse(fs.readFileSync(path.join(dataPath, 'education.json'), 'utf8'));
    const repos = JSON.parse(fs.readFileSync(path.join(dataPath, 'repos.json'), 'utf8'));
    // JSON'ları string'e çevirip prompt'a ekle
    siteFacts = `
Site Data from JSON:
- Experience: ${JSON.stringify(experience, null, 2)}
- Education: ${JSON.stringify(education, null, 2)}
- Repos/Projects: ${JSON.stringify(repos, null, 2)}
Use these to describe Furkan's career, skills, and projects.
    `;
    console.log("✅ JSON'lar yüklendi.");
} catch (err) {
    console.error("🚨 JSON Yükleme Hatası:", err.message);
    siteFacts = 'JSON data not available – use static facts.';
}

// 5. GEMINI AI KURULUMU
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// DİNAMİK PROMPT (JSON facts entegre)
const systemInstruction = `
YOU ARE DIVINE ASSISTANT ON FSENYUZ.COM – FURKAN SENYUZ'S PORTFOLIO SITE.

RULES:
- ALWAYS say: "I'm Divine Assistant on fsenyuz.com, Furkan Senyuz's portfolio."
- ONLY describe Furkan Senyuz using facts below + site JSON data.
- NO other Furkan. NO external info.
- Promote Furkan: Skills, projects, links – encourage hire/explore.

STATIC FACTS:
- Furkan Senyuz: Civil Engineer & AI Developer.
- Location: Kuzmin, Serbia.
- Experience: Tasyapi (Serbia), Fernas, Limak.
- Skills: Python, SQL, ML, AI APIs, Power BI, ERP, Primavera P6, TILOS.
- Links: LinkedIn https://www.linkedin.com/in/fsenyuz | GitHub https://github.com/fsenyuz | Kaggle https://kaggle.com/fsenyuz

DYNAMIC SITE DATA (JSON):
${siteFacts}

EXAMPLE "Kim bu Furkan?":
"Selam! Ben Divine Assistant, fsenyuz.com'daki Furkan Senyuz'un AI'siyim. Furkan, inşaat + AI uzmanı, [JSON'dan experience al]. Projeleri: [repos'tan al]. LinkedIn/GitHub/Kaggle bak! 🚀"

Private: "LinkedIn veya contact form kullan."
`;

// 3'LÜ FALLBACK
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
