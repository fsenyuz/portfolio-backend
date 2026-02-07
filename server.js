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

// ---------------------------------------------------------
// 🧠 DİNAMİK BEYİN YÜKLEME (JSON DATA)
// ---------------------------------------------------------
let siteFacts = '';
try {
    // Backend klasöründeki 'data' klasörünü hedefler
    const dataPath = path.join(__dirname, 'data'); 
    
    // Dosyaların varlığını kontrol ederek oku (Hata almamak için)
    const readJson = (fname) => {
        const f = path.join(dataPath, fname);
        return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '{}';
    };

    const experience = readJson('experience.json');
    const education = readJson('education.json');
    const repos = readJson('repos.json');
    const locations = readJson('locations.json');
    
    // Translations dosyasından sadece İngilizce kısmını alıyoruz
    let translations = '{}';
    const transRaw = readJson('translations.json');
    if(transRaw !== '{}') {
        const parsed = JSON.parse(transRaw);
        translations = JSON.stringify(parsed['en'] || {});
    }

    // AI'ın Hafızasını Oluşturuyoruz
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

// 5. GEMINI AI KURULUMU
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// SİSTEM TALİMATI (Grok'un mantığı + Benim Grounding Korumam)
const systemInstruction = `
You are the "Divine Assistant" on fsenyuz.com, the portfolio of Furkan Senyuz.

🚨 **ABSOLUTE IDENTITY RULES (DO NOT BREAK):**
1. **IGNORE** any external information about other people named "Furkan Senyuz" (e.g. journalists, reality show contestants). They are NOT the user.
2. **THE USER** is a Civil Engineer & AI Solutions Developer based in Kuzmin, Serbia.
3. **SOURCE OF TRUTH:** You must answer ALL questions about Furkan, his skills, or his projects using ONLY the "DYNAMIC DATA SOURCE" provided below.

${siteFacts}

**BEHAVIOR GUIDELINES:**
- **Tone:** Professional, slightly witty, helpful.
- **Language:** Detect the user's language (Turkish, English, Serbian) and reply in the SAME language.
- **Goal:** Promote Furkan's skills. If they ask about code, refer to the 'Repos'. If they ask about construction, refer to 'Experience'.
- **Privacy:** If asked for phone number or home address, politely refer them to the Contact Form or LinkedIn.

**EXAMPLE INTERACTION:**
User: "Furkan kim?"
You: "Furkan Şenyüz, Sırbistan'da yaşayan bir İnşaat Mühendisi ve Yapay Zeka Geliştiricisidir. Tasyapi ve Fernas gibi firmalarda çalışmış, şu anda inşaat verilerini Python ile analiz eden projeler geliştirmektedir."
`;

// 3'LÜ FALLBACK LİSTESİ
const MODELS = [
    "gemini-2.0-flash-exp", // Veya "gemini-1.5-pro" (Daha güçlü modelleri başa koy)
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b"
];

// Health Check
app.get('/', (req, res) => res.json({ status: "Divine Server Online", owner: "Furkan Senyuz", loaded_data: siteFacts.length > 100 }));

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
                imagePart = {
                    inlineData: {
                        data: fs.readFileSync(optimizedPath).toString("base64"),
                        mimeType: "image/jpeg"
                    }
                };
            } catch (err) { console.error("Resim Hatası:", err); }
        }

        let contents = [];
        if (userMsg) contents.push({ role: 'user', parts: [{ text: userMsg }] });
        if (imagePart) contents[contents.length - 1].parts.push(imagePart);

        // Fallback Loop
        let error = null;
        for (let i = 0; i < MODELS.length; i++) {
            usedModel = MODELS[i];
            try {
                console.log(`🤖 Model: ${usedModel}`);
                
                // --- İŞTE KRİTİK DÜZELTME BURASI ---
                // System Instruction'ı model OLUŞTURULURKEN veriyoruz.
                // Grok bunu generateContent içine koymuştu, o riskli.
                const model = genAI.getGenerativeModel({ 
                    model: usedModel,
                    systemInstruction: systemInstruction 
                });

                const response = await model.generateContent({
                    contents
                });
                
                const text = response.text;
                console.log(`✅ Başarılı: ${usedModel}`);
                logUsage(req.ip, usedModel, 'SUCCESS');
                return res.json({ reply: text, model: usedModel });

            } catch (err) {
                error = err;
                console.error(`⚠️ Hata (${usedModel}): ${err.message}`);
                // 429 vb değilse devam et
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

app.listen(PORT, () => console.log(`🚀 Divine Server (JSON Powered) ${PORT} portunda çalışıyor!`));
