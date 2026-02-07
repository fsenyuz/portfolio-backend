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

// 5. DATA.JSON OKUMA VE SYSTEM INSTRUCTION OLUŞTURMA
let systemInstructionText = "";

try {
    // data.json dosyasını bul (root dizinde veya data klasöründe)
    let rawData = null;
    const possiblePaths = [
        path.join(__dirname, 'data.json'),
        path.join(__dirname, 'data', 'data.json')
    ];

    for (let p of possiblePaths) {
        if (fs.existsSync(p)) {
            rawData = fs.readFileSync(p, 'utf8');
            console.log(`✅ Veri seti bulundu: ${p}`);
            break;
        }
    }

    if (!rawData) throw new Error("data.json bulunamadı!");

    const portfolioData = JSON.parse(rawData);

    // JSON verilerini temiz bir stringe döküyoruz
    // NOT: data.json içindeki yapın: { education: [], experience: [], repos: {}, locations: [], translations: {} }
    const contextData = {
        Experience: portfolioData.experience,
        Education: portfolioData.education,
        Projects: portfolioData.repos,
        Locations: portfolioData.locations,
        Skills_Translations: portfolioData.translations
    };

    systemInstructionText = `
    ROLE: You are the "Divine Assistant" on fsenyuz.com, Furkan Senyuz's portfolio website.
    
    MISSION: Promote Furkan Senyuz. Use the DATA below to answer questions about his career, projects, and skills.
    
    OFFICIAL DATA SOURCE (Use this to answer):
    ${JSON.stringify(contextData, null, 2)}

    RULES:
    1. Only use the provided JSON data. Do not hallucinate.
    2. If the user asks "Who is Furkan?", summarize his role as Civil Engineer & AI Developer.
    3. Be professional, slightly technical, and enthusiastic.
    4. Speak the language of the user (Turkish or English) based on their input.
    `;
    
    console.log("✅ AI Hafızası (System Instruction) yüklendi.");

} catch (err) {
    console.error("🚨 VERİ YÜKLEME HATASI:", err.message);
    systemInstructionText = "You are an AI assistant for Furkan Senyuz. I cannot access the full database right now. Furkan is a Civil Engineer & AI Developer.";
}

// 6. GEMINI AI KURULUMU
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// SENİN BELİRLEDİĞİN MODELLER (Orijinal Listen)
const MODELS = [
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite"
];

// Health Check
app.get('/', (req, res) => res.json({ status: "Online", owner: "Furkan Senyuz", active_models: MODELS }));

// 7. CHAT ROTASI
app.post('/chat', upload.single('image'), async (req, res) => {
    let imagePath = null;
    let usedModel = null;

    try {
        console.log(`📩 Mesaj: IP ${req.ip}`);
        const userMsg = sanitizeHtml(req.body.message || "", { allowedTags: [] });
        
        let imagePart = null;
        if (req.file) {
            imagePath = req.file.path;
            const imageBuffer = await sharp(imagePath).resize(800).jpeg({ quality: 80 }).toBuffer();
            imagePart = {
                inlineData: {
                    data: imageBuffer.toString("base64"),
                    mimeType: "image/jpeg"
                }
            };
        }

        let contents = [{ role: 'user', parts: [{ text: userMsg }] }];
        if (imagePart) contents[0].parts.push(imagePart);

        let finalReply = null;

        // Modelleri sırayla dene
        for (const modelName of MODELS) {
            try {
                usedModel = modelName;
                console.log(`🤖 Model deneniyor: ${usedModel}`);
                
                const model = genAI.getGenerativeModel({ 
                    model: usedModel,
                    systemInstruction: systemInstructionText // <-- İŞTE BURASI ÖNEMLİ: Veriyi modele burada veriyoruz
                });

                const result = await model.generateContent({ contents });
                finalReply = result.response.text();
                
                console.log(`✅ Başarılı: ${usedModel}`);
                logUsage(req.ip, usedModel, 'SUCCESS');
                break; 
            } catch (err) {
                console.error(`⚠️ ${usedModel} Hatası: ${err.message}`);
                continue; // Bir sonraki modele geç
            }
        }

        if (!finalReply) throw new Error("Hiçbir model yanıt veremedi.");

        res.json({ reply: finalReply, model: usedModel });

    } catch (error) {
        console.error("🚨 SERVER HATASI:", error.message);
        res.status(500).json({ reply: "Bağlantı hatası. Lütfen tekrar dene." });
    } finally {
        if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    }
});

app.listen(PORT, () => console.log(`🚀 Server ${PORT} portunda çalışıyor. Modeller: ${MODELS.join(', ')}`));
