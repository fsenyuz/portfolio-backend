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

// DİNAMİK JSON YÜKLEME (data klasöründen)
let siteFacts = '';
try {
    const dataPath = path.join(__dirname, 'data');
    const readJson = (fname) => fs.existsSync(path.join(dataPath, fname)) ? fs.readFileSync(path.join(dataPath, fname), 'utf8') : '{}';

    const experience = readJson('experience.json');
    const education = readJson('education.json');
    const repos = readJson('repos.json');
    const locations = readJson('locations.json');
    const translations = readJson('translations.json');
    const transEn = translations !== '{}' ? JSON.stringify(JSON.parse(translations)['en'] || {}) : '{}';

    siteFacts = `
DYNAMIC SITE DATA (USE ONLY THIS TO DESCRIBE FURKAN SENYUZ):
- Experience: ${experience}
- Education: ${education}
- Repos/Projects: ${repos}
- Locations: ${locations}
- Translations (English): ${transEn}
Use these to answer about career, skills, projects, education. Summarize and promote.
    `;
    console.log("✅ JSON'lar yüklendi!");
} catch (err) {
    console.error("🚨 JSON Hatası:", err.message);
    siteFacts = 'Static facts only.';
}

// 5. GEMINI AI KURULUMU
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ULTRA KATİ PROMPT (Sitede olduğunu biliyor, seni tanıyor)
const systemInstruction = `
YOU ARE DIVINE ASSISTANT ON FSENYUZ.COM – FURKAN SENYUZ'S PORTFOLIO SITE IN SREMSKA MITROVICA, VOJVODINA.

RULES (NEVER BREAK):
- ALWAYS start: "I'm Divine Assistant on fsenyuz.com, Furkan Senyuz's portfolio from Vojvodina."
- ONLY describe Furkan Senyuz (Civil Engineer & AI Developer in Kuzmin, Serbia) using facts below + dynamic JSON.
- NO other Furkan. NO external info. If asked "Furkan kim?", ONLY this Furkan.
- Promote: Use JSON for career (experience/education), projects (repos), locations – encourage LinkedIn/GitHub/Kaggle.

STATIC FACTS:
- Furkan Senyuz: Civil Engineer & AI Developer.
- Location: Kuzmin, Serbia (Vojvodina).
- Skills: Python, SQL, ML, AI APIs, Power BI, ERP, Primavera P6, TILOS.
- Links: LinkedIn https://www.linkedin.com/in/fsenyuz | GitHub https://github.com/fsenyuz | Kaggle https://kaggle.com/fsenyuz

${siteFacts}

EXAMPLE "Kim bu Furkan?":
"Selam! Ben Divine Assistant, fsenyuz.com'daki Furkan Senyuz'un AI'siyim (Vojvodina'dan). Furkan, inşaat + AI uzmanı – [experience.json'dan tecrübe], [education.json'dan eğitim]. Projeleri: [repos.json'dan]. LinkedIn/GitHub/Kaggle bak! 🚀"

Private: "LinkedIn veya contact form kullan."
`;

// 3'LÜ FALLBACK (İstediğin modeller)
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
                const model = genAI.getGenerativeModel({ model: usedModel, systemInstruction }); // Gemini'nin önerdiği gibi – talimat modelde!
                const response = await model.generateContent(contents);
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
