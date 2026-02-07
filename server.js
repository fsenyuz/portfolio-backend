const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const sharp = require('sharp');
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');
const sanitizeHtml = require('sanitize-html');

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.GEMINI_API_KEY) {
    console.error("🚨 KRİTİK HATA: GEMINI_API_KEY bulunamadı!");
    process.exit(1);
}

if (!fs.existsSync('logs')) fs.mkdirSync('logs');

app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json());

function logUsage(ip, model, status) {
    try {
        const date = new Date().toISOString().split('T')[0];
        const entry = `${new Date().toISOString()} | IP: ${ip} | Model: ${model} | Status: ${status}\n`;
        fs.appendFile(path.join('logs', `usage-${date}.log`), entry, () => {});
    } catch (e) { console.error("Log Error:", e); }
}

const upload = multer({ dest: 'uploads/', limits: { fileSize: 5 * 1024 * 1024 } });

// System instruction'ı KISALTTIK (token tasarrufu + daha stabil)
let systemInstruction = "";

try {
    let rawData = null;
    const possiblePaths = [path.join(__dirname, 'data.json'), path.join(__dirname, 'data', 'data.json')];

    for (let p of possiblePaths) {
        if (fs.existsSync(p)) {
            rawData = fs.readFileSync(p, 'utf8');
            console.log(`✅ Veri seti bulundu: ${p}`);
            break;
        }
    }

    if (!rawData) throw new Error("data.json bulunamadı!");

    const portfolioData = JSON.parse(rawData);

    // Sadece temel özet + veri kaynağı (detayları model hallucinate etmeden kullanır)
    systemInstruction = `
    Sen "Divine Assistant"sin, fsenyuz.com'da Furkan Şenyüz'ün portföy sitesinde çalışıyorsun.
    
    Furkan'ı tanıt: İnşaat Mühendisi & Yapay Zeka Geliştiricisi. Sırbistan'da Tasyapi'de Teknik Ofis Şefi olarak çalışıyor, mega projelerde deneyim var.
    
    RESMİ VERİ KAYNAĞI (Sadece bundan cevap ver, uydurma):
    Deneyim: ${JSON.stringify(portfolioData.experience.map(e => `${e.company} - ${e.date} (${e.loc})`))}
    Eğitim: ${JSON.stringify(portfolioData.education.map(e => `${e.company} - ${e.date}`))}
    Projeler: ${JSON.stringify(portfolioData.repos)}
    Konumlar: ${JSON.stringify(portfolioData.locations.map(l => l.t))}
    Çeviriler: Mevcut (TR/EN/SR)
    
    Kurallar:
    1. Sadece bu veriyi kullan, asla uydurma.
    2. "Furkan kim?" diye sorulursa: "Civil Engineer & AI Developer, şu an Sırbistan'da büyük altyapı projelerinde çalışıyor."
    3. Profesyonel, teknik ve heyecanlı ol.
    4. Kullanıcının dilinde cevap ver (Türkçe/İngilizce/Sırpça).
    `;

    console.log("✅ AI Hafızası yüklendi (kısaltılmış versiyon).");

} catch (err) {
    console.error("🚨 VERİ HATASI:", err.message);
    systemInstruction = "Sen Furkan Şenyüz'ün asistanısın. Furkan İnşaat Mühendisi & AI Geliştiricisi.";
}

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// GÜNCEL ÇALIŞAN MODELLER (önce en stabil olanlar)
const MODELS = [
    "gemini-2.5-flash",        // Logunda çalışan, en hızlı/ucuz
    "gemini-2.5-pro",          // Daha güçlü
    "gemini-3-flash-preview",  // En yeni hızlı
    "gemini-3-pro-preview",    // En güçlü preview
    "gemini-2.5-flash-lite"
];

app.get('/', (req, res) => res.json({ 
    status: "Online", 
    owner: "Furkan Senyuz", 
    active_models: MODELS,
    note: "2026 güncel modeller, ilk çalışan kullanılır."
}));

app.post('/chat', upload.single('image'), async (req, res) => {
    let imagePath = null;
    let usedModel = null;

    try {
        console.log(`📩 Mesaj: IP ${req.ip}`);
        const userMsg = sanitizeHtml(req.body.message || "", { allowedTags: [] }).trim();
        if (!userMsg && !req.file) throw new Error("İçerik yok");

        const contents = [{ role: 'user', parts: [{ text: userMsg }] }];

        if (req.file) {
            imagePath = req.file.path;
            const imageBuffer = await sharp(imagePath).resize(800).jpeg({ quality: 80 }).toBuffer();
            contents[0].parts.push({
                inlineData: { data: imageBuffer.toString("base64"), mimeType: "image/jpeg" }
            });
        }

        let finalReply = null;

        for (const modelName of MODELS) {
            try {
                usedModel = modelName;
                console.log(`🤖 Denenen: ${usedModel}`);

                const response = await genAI.models.generateContent({
                    model: modelName,
                    systemInstruction: systemInstruction,
                    contents: contents
                });

                finalReply = response.text || "Yanıt alınamadı.";

                console.log(`✅ Başarılı: ${usedModel}`);
                logUsage(req.ip, usedModel, 'SUCCESS');
                break;
            } catch (err) {
                console.error(`⚠️ ${modelName} Hatası: ${err.message}`);
            }
        }

        if (!finalReply) throw new Error("Tüm modeller başarısız.");

        res.json({ reply: finalReply, model: usedModel });

    } catch (error) {
        console.error("🚨 HATA:", error.message);
        res.status(500).json({ reply: "Sunucu hatası, tekrar dene." });
    } finally {
        if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    }
});

app.listen(PORT, () => console.log(`🚀 Server hazır. Modeller: ${MODELS.join(', ')}`));
