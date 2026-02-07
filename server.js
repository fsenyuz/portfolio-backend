const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const sharp = require('sharp');
const { GoogleGenAI } = require('@google/genai');  // Yeni unified SDK
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

// ---------------------------------------------------------
// [YENİ] JSON VERİSİNİ OKUMA BLOĞU
// ---------------------------------------------------------
let profileData = {};
try {
    // 'data' klasörü içindeki profile.json dosyasını okuyoruz
    const jsonPath = path.join(__dirname, 'data', 'profile.json');
    
    if (fs.existsSync(jsonPath)) {
        const rawData = fs.readFileSync(jsonPath, 'utf8');
        profileData = JSON.parse(rawData);
        console.log("✅ Profil verisi (JSON) başarıyla yüklendi.");
    } else {
        console.warn("⚠️ UYARI: data/profile.json bulunamadı! Varsayılan veriler kullanılacak.");
        // Dosya yoksa çökmemesi için yedek veri
        profileData = { user: { name: "Furkan Senyuz", role: "Civil Engineer & AI Developer" } }; 
    }
} catch (error) {
    console.error("🚨 JSON Okuma Hatası:", error);
}

// 2. MIDDLEWARE
app.use(cors({
    origin: '*', // Prodüksiyonda fsenyuz.com olarak kısıtla
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

// ---------------------------------------------------------
// [KRİTİK REVİZE] SYSTEM INSTRUCTION - BEYİN YIKAMA KISMI
// ---------------------------------------------------------
// Burada bota "Furkan kim" dendiğinde isim analizi yapmasını YASAKLIYORUZ.
const systemInstruction = `
You are the "Divine Assistant" for ${profileData.user?.name || 'Furkan Senyuz'}'s portfolio website.

🚨 **CRITICAL INSTRUCTIONS (IDENTITY & GROUNDING):**
1. **IGNORE** all external data about a "Furkan Senyuz" who is a Journalist, Reality Show Contestant, or Athlete.
2. **THE "WHO IS" RULE:** If the user asks "Who is Furkan?", "Furkan kim?", or "Kimsin?", **YOU MUST NOT** explain the etymological meaning of the name "Furkan" (e.g., "hakkı batıldan ayıran") and **YOU MUST NOT** list famous people like Furkan Korkmaz or Furkan Palalı.
3. **CORRECT RESPONSE:** Instead, synthesize the answer ONLY from the JSON data below (e.g., "Furkan Senyuz is a Civil Engineer & AI Developer based in Serbia...").

**KNOWLEDGE BASE (SOURCE OF TRUTH):**
${JSON.stringify(profileData, null, 2)}

**TONE & STYLE:**
- Persona: Professional, slightly witty/divine (Oracle theme).
- Language: Detect user's language (Turkish/English) and reply in the SAME language.
- Goal: Encourage hiring Furkan or viewing his projects.
`;

// --- MODEL DİZİSİ (Senin istediğin liste) ---
const MODELS = [
    "gemini-3-flash-preview", 
    "gemini-2.5-flash",       
    "gemini-2.5-flash-lite"   
];

// Health Check
app.get('/', (req, res) => res.json({ status: "Divine Server Online", owner: profileData.user?.name, models: MODELS }));

// 6. CHAT ROTASI
app.post('/chat', upload.single('image'), async (req, res) => {
    let imagePath = null;
    let optimizedPath = null;
    let usedModel = null; 

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
            } catch (err) { console.error("Resim İşleme Hatası:", err); }
        }

        // Prompt Hazırlığı
        let contents = [];
        if (userMsg) contents.push({ role: 'user', parts: [{ text: userMsg }] });
        if (imagePart) contents[contents.length - 1].parts.push(imagePart);

        // Fallback Loop
        let error = null;
        for (let i = 0; i < MODELS.length; i++) {
            usedModel = MODELS[i];
            try {
                console.log(`🤖 Gemini (${usedModel}) Düşünüyor...`);
                
                // --- 🛠️ KRİTİK DÜZELTME BURADA ---
                // systemInstruction'ı burada model oluşturulurken veriyoruz.
                // Bu, modelin kimliğini ve kurallarını en baştan yüklemesini sağlar.
                const model = genAI.getGenerativeModel({ 
                    model: usedModel,
                    systemInstruction: systemInstruction 
                });

                const response = await model.generateContent({
                    contents
                });
                
                const text = response.text;
                console.log(`✅ Cevap Başarılı (Model: ${usedModel}).`);
                logUsage(req.ip, usedModel, 'SUCCESS');
                
                return res.json({ reply: text, model: usedModel }); 

            } catch (err) {
                error = err;
                console.error(`🚨 Model Hatası (${usedModel}):`, err.message);
                
                // 429 veya 503 gibi geçici hatalarda diğer modele geç
                if (!err.message.includes("429") && !err.message.includes("404")) {
                   // Diğer hatalarda da şansımızı deniyoruz
                }
            }
        }
        
        throw error || new Error("Tüm modeller meşgul veya erişilemez.");

    } catch (error) {
        console.error("🚨 SERVER HATASI:", error.message);
        if (usedModel) logUsage(req.ip, usedModel, 'ERROR');

        let userReply = "Bağlantıda kozmik bir sorun oluştu. Lütfen tekrar dene. 🤖";
        if (error.message.includes("429")) userReply = "Oracle şu an çok yoğun, biraz bekle.";

        res.status(500).json({ 
            reply: userReply, 
            error: error.message 
        });

    } finally {
        if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
        if (optimizedPath && fs.existsSync(optimizedPath)) fs.unlinkSync(optimizedPath);
    }
});

app.listen(PORT, () => console.log(`🚀 Divine Server ${PORT} portunda çalışıyor! Modeller: ${MODELS.join(', ')}`));
