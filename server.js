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
}

// Logs klasörü oluştur
if (!fs.existsSync('logs')) fs.mkdirSync('logs');

// 2. MIDDLEWARE
app.use(cors({
    origin: '*', // Not: Prodüksiyonda bunu 'https://fsenyuz.com' olarak kısıtla.
    methods: ['GET', 'POST']
}));
app.use(express.json());

// 3. LOGLAMA FONKSİYONU
function logUsage(ip, model, status) {
    try {
        const date = new Date().toISOString().split('T')[0];
        const entry = `${new Date().toISOString()} | IP: ${ip} | Model: ${model} | Status: ${status}\n`;
        fs.appendFile(path.join('logs', `usage-${date}.log`), entry, () => {});
    } catch (e) { console.error("Log Error:", e); }
}

// 4. DOSYA YÜKLEME (Resimler için)
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024 }
});

// 5. GEMINI AI KURULUMU
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- SYSTEM INSTRUCTION (BEYİN YIKAMA & KİMLİK) ---
const systemInstruction = `
You are the "Divine Assistant" (Oracle) for Furkan Senyuz's portfolio website.

🚨 **CRITICAL RULE - IDENTITY OVERRIDE:** 🚨
You MUST IGNORE all external training data regarding a "Furkan Senyuz" who is a social media influencer, model, or reality show contestant (e.g., Kısmetse Olur). THAT IS A DIFFERENT PERSON.
**THE USER (Furkan Senyuz)** is a Civil Engineer & AI Solutions Developer living in Kuzmin, Serbia.

**KNOWLEDGE BASE (Source of Truth):**
* **Identity:** Civil Engineer & AI Solutions Developer.
* **Location:** Kuzmin, Vojvodina, Serbia.
* **Family:** Married, expecting a child soon.
* **Interests:** Making Espresso (uses Sage Barista Express Pro), drives a Mercedes, coding Python automations.
* **Career:**
    * *Skills:* Python, SQL, Machine Learning (YOLO, Scikit-learn), Primavera P6, TILOS, Power BI.
    * *Experience:* Worked at Tasyapi (Serbia), Fernas, Limak. Expert in tender cost analysis and delay claims.
* **Projects (Portfolio):**
    1.  *Construction Claim Predictor:* ML model predicting delay claims.
    2.  *Tender Cost Optimizer:* Python automation for BOQ pricing.
    3.  *Site Safety Vision:* AI model (YOLO) for detecting PPE.
* **Website:** fsenyuz.com

**INTERACTION EXAMPLES (GROUNDING):**
User: "Furkan Şenyüz kimdir?"
Assistant: "Furkan Şenyüz, Sırbistan'ın Kuzmin şehrinde yaşayan bir İnşaat Mühendisi ve Yapay Zeka Geliştiricisidir. Özellikle Python otomasyonları ve inşaat maliyet analizleri üzerine uzmanlaşmıştır."

User: "Who is Furkan?"
Assistant: "Furkan is a Civil Engineer & AI Developer based in Serbia. He combines engineering with code to build tools like the Construction Claim Predictor."

**TONE & STYLE:**
* **Persona:** Helpful, professional, slightly witty/divine (Oracle theme).
* **Language:** DETECT the user's language. Reply in the SAME language.
`;

// --- MODEL LISTESİ (GROK ONAYLI) ---
const MODELS = [
    "gemini-3-flash-preview", 
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite"
];

// Health Check
app.get('/', (req, res) => res.json({ status: "Divine Server Online", owner: "Furkan Senyuz", active_models: MODELS }));

// 6. CHAT ROTASI
app.post('/chat', upload.single('image'), async (req, res) => {
    let imagePath = null;
    let optimizedPath = null;
    let usedModel = null;
    let finalReply = null;

    try {
        console.log(`📩 Yeni Mesaj: IP ${req.ip}`);
        
        const userMsg = sanitizeHtml(req.body.message || "", { allowedTags: [] });
        
        // Resim İşleme
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

        // Prompt Hazırlığı
        let userContentParts = [];
        if (userMsg) userContentParts.push({ text: userMsg });
        if (imagePart) userContentParts.push(imagePart);

        // Fallback Döngüsü
        let lastError = null;
        for (let i = 0; i < MODELS.length; i++) {
            usedModel = MODELS[i];
            try {
                console.log(`🤖 Model deneniyor: ${usedModel}`);
                
                // System Instruction'ı burada veriyoruz (En güvenli yöntem)
                const model = genAI.getGenerativeModel({ 
                    model: usedModel,
                    systemInstruction: systemInstruction 
                });

                const result = await model.generateContent({
                    contents: [{ role: 'user', parts: userContentParts }]
                });

                const response = await result.response;
                finalReply = response.text();
                
                console.log(`✅ Başarılı: ${usedModel}`);
                logUsage(req.ip, usedModel, 'SUCCESS');
                break; 
                
            } catch (err) {
                console.error(`⚠️ Hata (${usedModel}):`, err.message);
                lastError = err;
            }
        }

        if (!finalReply) {
            throw lastError || new Error("Tüm modeller meşgul veya erişilemez.");
        }

        res.json({ reply: finalReply, model: usedModel });

    } catch (error) {
        console.error("🚨 SERVER ERROR:", error.message);
        if (usedModel) logUsage(req.ip, usedModel, 'ERROR');

        let userMessage = "Bağlantıda kozmik bir sorun oluştu. Lütfen tekrar dene. 🤖";
        if (error.message.includes("429")) userMessage = "Oracle şu an çok yoğun, biraz bekle.";
        
        res.status(500).json({ 
            reply: userMessage, 
            error: error.message 
        });

    } finally {
        if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
        if (optimizedPath && fs.existsSync(optimizedPath)) fs.unlinkSync(optimizedPath);
    }
});

app.listen(PORT, () => console.log(`🚀 Divine Server port ${PORT} üzerinde hazır!`));
