const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const sharp = require('sharp');
// DİKKAT: Yeni SDK importu bu şekildedir
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
}

// Logs klasörü
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

// ---------------------------------------------------------
// 🧠 DİNAMİK BEYİN YÜKLEME (JSON DATA)
// ---------------------------------------------------------
let siteFacts = '';
try {
    const dataPath = path.join(__dirname, 'data');
    
    // Güvenli dosya okuma fonksiyonu
    const readJson = (fname) => {
        const f = path.join(dataPath, fname);
        return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '{}';
    };

    const experience = readJson('experience.json');
    const education = readJson('education.json');
    const repos = readJson('repos.json');
    const locations = readJson('locations.json');
    
    let translations = '{}';
    const transRaw = readJson('translations.json');
    if(transRaw !== '{}') {
        const parsed = JSON.parse(transRaw);
        translations = JSON.stringify(parsed['en'] || {});
    }

    siteFacts = `
    *** DYNAMIC DATA SOURCE (Use this to answer) ***
    - Professional Experience: ${experience}
    - Education & Certs: ${education}
    - GitHub Projects (Repos): ${repos}
    - Work Locations: ${locations}
    - Site Terminology: ${translations}
    `;
    console.log("✅ JSON Verileri Hafızaya Yüklendi!");
} catch (err) {
    console.error("🚨 JSON Yükleme Uyarısı:", err.message);
    siteFacts = 'Data files not found. Rely on static context.';
}

// 5. GEMINI AI KURULUMU (YENİ SDK)
// Yeni SDK'da client doğrudan oluşturulur
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// SİSTEM TALİMATI
const systemInstructionText = `
You are the "Divine Assistant" on fsenyuz.com, the portfolio of Furkan Senyuz.

🚨 **ABSOLUTE IDENTITY RULES:**
1. **IGNORE** any external information about "Furkan Senyuz" (journalists, reality stars, etc.).
2. **THE USER** is a Civil Engineer & AI Solutions Developer based in Kuzmin, Serbia.
3. **SOURCE OF TRUTH:** Answer ALL questions using ONLY the "DYNAMIC DATA SOURCE" below.

${siteFacts}

**BEHAVIOR:**
- **Tone:** Professional, slightly witty, helpful.
- **Language:** Detect user's language and reply in the SAME language.
- **Privacy:** Redirect sensitive info requests to Contact Form.

**EXAMPLE:**
User: "Furkan kim?"
You: "Furkan Şenyüz, Sırbistan'da yaşayan bir İnşaat Mühendisi ve AI Geliştiricisidir. [experience.json] verilerine göre..."
`;

// MODEL LİSTESİ (Yeni SDK ile uyumlu model isimleri)
const MODELS = [
    "gemini-2.0-flash-exp", 
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b"
];

// Health Check
app.get('/', (req, res) => res.json({ status: "Divine Server Online", sdk: "@google/genai", models: MODELS }));

// 6. CHAT ROTASI
app.post('/chat', upload.single('image'), async (req, res) => {
    let imagePath = null;
    let optimizedPath = null;
    let usedModel = null;

    try {
        console.log(`📩 Mesaj Geldi: IP ${req.ip}`);
        const userMsg = sanitizeHtml(req.body.message || "", { allowedTags: [] });
        
        // Resim İşleme
        let imagePart = null;
        if (req.file) {
            imagePath = req.file.path;
            optimizedPath = req.file.path + '-opt.jpg';
            try {
                await sharp(imagePath).rotate().resize(800).jpeg({ quality: 80 }).toFile(optimizedPath);
                // Yeni SDK formatı için inlineData hazırlığı
                imagePart = {
                    inlineData: {
                        data: fs.readFileSync(optimizedPath).toString("base64"),
                        mimeType: "image/jpeg"
                    }
                };
            } catch (err) { console.error("Resim Hatası:", err); }
        }

        // İçerik Hazırlığı
        let contentParts = [];
        if (userMsg) contentParts.push({ text: userMsg });
        if (imagePart) contentParts.push(imagePart);

        // Fallback Loop
        let error = null;
        for (let i = 0; i < MODELS.length; i++) {
            usedModel = MODELS[i];
            try {
                console.log(`🤖 Model: ${usedModel}`);
                
                // --- YENİ SDK KULLANIMI (DÜZELTİLEN KISIM) ---
                // getGenerativeModel YERİNE ai.models.generateContent kullanıyoruz.
                const response = await ai.models.generateContent({
                    model: usedModel,
                    contents: [{ role: 'user', parts: contentParts }],
                    config: {
                        // System Instruction buraya, 'config' içine gelmeli!
                        systemInstruction: systemInstructionText,
                        temperature: 0.7,
                    }
                });
                // ----------------------------------------------
                
                // Yeni SDK yanıt yapısı bazen farklı olabilir, text() metodu genellikle vardır.
                const text = response.text; 
                
                console.log(`✅ Başarılı: ${usedModel}`);
                logUsage(req.ip, usedModel, 'SUCCESS');
                return res.json({ reply: text, model: usedModel });

            } catch (err) {
                error = err;
                console.error(`⚠️ Hata (${usedModel}): ${err.message}`);
                // 404 (Model yok) veya 429 (Kota) hatalarında devam et
            }
        }
        throw error || new Error("Modeller cevap veremedi.");

    } catch (error) {
        console.error("🚨 SERVER HATASI:", error.message);
        res.status(500).json({ reply: "Bağlantıda sorun var. Tekrar dene. 🤖", error: error.message });
    } finally {
        if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
        if (optimizedPath && fs.existsSync(optimizedPath)) fs.unlinkSync(optimizedPath);
    }
});

app.listen(PORT, () => console.log(`🚀 Divine Server (New SDK) ${PORT} portunda çalışıyor!`));
