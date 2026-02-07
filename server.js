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

// API Key kontrol
if (!process.env.GEMINI_API_KEY) {
    console.error("🚨 KRİTİK HATA: GEMINI_API_KEY eksik!");
    process.exit(1);
}
console.log("✅ GEMINI_API_KEY yüklendi.");

// Logs klasörü
if (!fs.existsSync('logs')) fs.mkdirSync('logs');

// Middleware
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json());

// Loglama
function logUsage(ip, model, status) {
    try {
        const date = new Date().toISOString().split('T')[0];
        const entry = `${new Date().toISOString()} | IP: ${ip} | Model: ${model} | Status: ${status}\n`;
        fs.appendFileSync(path.join('logs', `usage-${date}.log`), entry);
    } catch (e) {
        console.error("Log hatası:", e);
    }
}

// Dosya yükleme
const upload = multer({ dest: 'uploads/', limits: { fileSize: 5 * 1024 * 1024 } });

// TEK DATA.JSON YÜKLEME
let siteFacts = '';
try {
    const dataFilePath = path.join(__dirname, 'data.json');
    const data = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));

    siteFacts = `
DINAMIK SITE VERILERI (FURKAN'I TANITIRKEN MUTLAKA BUNLARI KULLAN):

- Experience: ${JSON.stringify(data.experience, null, 2)}
- Education: ${JSON.stringify(data.education, null, 2)}
- Locations (harita): ${JSON.stringify(data.locations, null, 2)}
- Repos/Projects: ${JSON.stringify(data.repos, null, 2)}
- Translations (dil desteği): ${JSON.stringify(data.translations, null, 2)}

Bu verileri kullanarak Furkan'ın kariyerini, projelerini, eğitimini ve global deneyimini detaylı anlat. Repoları tanıt, LinkedIn/GitHub linklerini ver, işe alım için teşvik et.
    `;
    console.log("✅ data.json başarıyla yüklendi ve prompt'a entegre edildi!");
} catch (err) {
    console.error("🚨 data.json yükleme hatası:", err.message);
    siteFacts = 'Dinamik veri yüklenemedi. Sadece statik bilgiler kullanılacak.';
}

// Gemini kurulumu
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Güncel modeller (fallback sırasıyla)
const MODELS = [
    "gemini-1.5-flash",
    "gemini-1.5-pro",
    "gemini-1.0-pro"
];

// System prompt (daha güçlü hale getirildi)
const systemInstruction = `
SEN FSENYUZ.COM'DAKI DIVINE ASSISTANT'SIN – FURKAN ŞENYÜZ'ÜN PORTFOLYO SITESININ AI ASISTANI.

KATI KURALLAR:
- Her cevaba şu şekilde başla: "Ben fsenyuz.com'daki Divine Assistant'ım, Furkan Şenyüz'ün AI asistanıyım."
- Furkan'ı TANITIRKEN sadece aşağıdaki statik bilgiler + dinamik JSON verilerini (${siteFacts}) kullan. Başka hiçbir şey uydurma.
- Kullanıcının mesaj dilini tespit et ve aynı dilde cevap ver (Türkçe → tr, Sırpça → sr, İngilizce → en çevirileri kullan).
- Furkan'ı her fırsatta öv, deneyimlerini, eğitimlerini, AI projelerini detaylı anlat, GitHub repolarını tanıt, LinkedIn'e yönlendir.
- Siteyi keşfetmeye, iletişim formunu kullanmaya teşvik et.

STATIK BILGILER:
- Furkan Şenyüz: İnşaat Mühendisi & AI Geliştirici.
- Konum: Kuzmin, Sırbistan.
- Yetkinlikler: Python, SQL, Machine Learning, AI API'leri, Power BI, Primavera P6, TILOS, FIDIC sözleşmeleri.
- Linkler: LinkedIn https://www.linkedin.com/in/fsenyuz | GitHub https://github.com/fsenyuz | Kaggle https://kaggle.com/fsenyuz

ÖRNEK (Türkçe soru):
"Kendini tanıt" → "Ben fsenyuz.com'daki Divine Assistant'ım... Furkan şu an Tasyapi'de €345M otoyol projesinde Teknik Ofis Şefi... Stanford ML sertifikası var... GitHub'da construction-claim-predictor reposuna bakabilirsin vs."
`;

// Health check
app.get('/', (req, res) => res.json({ status: "Online", owner: "Furkan Senyuz", models: MODELS }));

// Chat endpoint
app.post('/chat', upload.single('image'), async (req, res) => {
    let imagePath = null;
    let optimizedPath = null;
    let usedModel = null;

    try {
        console.log(`📩 Yeni istek – IP: ${req.ip}`);
        const userMsg = sanitizeHtml(req.body.message || "", { allowedTags: [] });

        let contents = [];
        let imagePart = null;

        if (req.file) {
            imagePath = req.file.path;
            optimizedPath = req.file.path + '-opt.jpg';
            await sharp(imagePath)
                .rotate()
                .resize(800)
                .jpeg({ quality: 80 })
                .toFile(optimizedPath);
            imagePart = {
                inlineData: {
                    data: fs.readFileSync(optimizedPath).toString("base64"),
                    mimeType: "image/jpeg"
                }
            };
        }

        if (userMsg) contents.push({ role: 'user', parts: [{ text: userMsg }] });
        if (imagePart) {
            if (contents.length === 0) contents.push({ role: 'user', parts: [] });
            contents[contents.length - 1].parts.push(imagePart);
        }

        let lastError = null;
        for (const modelName of MODELS) {
            usedModel = modelName;
            try {
                console.log(`🤖 ${modelName} deniyor...`);
                const response = await genAI.models.generateContent({
                    model: modelName,
                    contents,
                    generationConfig: { systemInstruction }
                });
                const text = response.text;

                logUsage(req.ip, modelName, 'SUCCESS');
                return res.json({ reply: text, model: modelName });
            } catch (err) {
                lastError = err;
                console.error(`🚨 ${modelName} hatası:`, err.message);
                logUsage(req.ip, modelName, 'ERROR');
            }
        }
        throw lastError || new Error("Tüm modeller başarısız.");

    } catch (error) {
        console.error("🚨 Genel hata:", error.message);
        logUsage(req.ip, usedModel || 'unknown', 'ERROR');
        res.status(500).json({ reply: "Şu an yoğunluk var veya kota doldu. Lütfen biraz sonra tekrar dene 🤖" });
    } finally {
        [imagePath, optimizedPath].forEach(p => p && fs.existsSync(p) && fs.unlinkSync(p));
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Divine Server ${PORT} portunda çalışıyor! Modeller: ${MODELS.join(', ')}`);
});
