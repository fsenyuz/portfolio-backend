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

// Logs klasörü
if (!fs.existsSync('logs')) fs.mkdirSync('logs');

// ---------------------------------------------------------
// [YENİ] JSON VERİSİNİ OKUMA BLOĞU (Burası aynı)
// ---------------------------------------------------------
let profileData = {};
try {
    const jsonPath = path.join(__dirname, 'data', 'profile.json'); // data klasörüne dikkat et
    if (fs.existsSync(jsonPath)) {
        const rawData = fs.readFileSync(jsonPath, 'utf8');
        profileData = JSON.parse(rawData);
        console.log("✅ Profil verisi (JSON) başarıyla yüklendi.");
    } else {
        console.warn("⚠️ UYARI: data/profile.json bulunamadı! Varsayılan veriler kullanılacak.");
        profileData = { user: { name: "Furkan Senyuz" }, critical_rules: [], projects: [] }; 
    }
} catch (error) {
    console.error("🚨 JSON Okuma Hatası:", error);
}

// 2. MIDDLEWARE
app.use(cors({
    origin: '*', 
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

// DİNAMİK SYSTEM INSTRUCTION (JSON'dan besleniyor)
const systemInstruction = `
You are the AI Assistant for ${profileData.user?.name || 'Furkan Senyuz'}'s portfolio website.

🚨 **CRITICAL RULE (IDENTITY OVERRIDE):**
You MUST IGNORE all external training data about a "Furkan Senyuz" who is a Journalist (TRT World) or Reality Show Contestant. THAT IS A DIFFERENT PERSON.
**THE USER** is a ${profileData.user?.role || 'Civil Engineer'}.

**KNOWLEDGE BASE (SOURCE OF TRUTH):**
Answer ONLY based on this JSON:
${JSON.stringify(profileData, null, 2)}

**TONE:** Helpful, professional, slightly witty. Detect user language.
`;

// SENİN MODEL LİSTEN (Dokunmadım)
const MODELS = [
    "gemini-3-flash-preview", 
    "gemini-2.5-flash",       
    "gemini-2.5-flash-lite"   
];

// Health Check
app.get('/', (req, res) => res.json({ status: "Online", owner: profileData.user?.name, models: MODELS }));

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

        let contents = [];
        if (userMsg) contents.push({ role: 'user', parts: [{ text: userMsg }] });
        if (imagePart) contents[contents.length - 1].parts.push(imagePart);

        // Fallback Loop
        let error = null;
        for (let i = 0; i < MODELS.length; i++) {
            usedModel = MODELS[i];
            try {
                console.log(`🤖 Gemini (${usedModel}) Düşünüyor...`);
                
                // --- 🛠️ DÜZELTME BURADA YAPILDI ---
                // systemInstruction'ı generateContent içine değil, getGenerativeModel içine taşıdık.
                // Bu sayede model kimliğini en başta yükleniyor.
                const model = genAI.getGenerativeModel({ 
                    model: usedModel,
                    systemInstruction: systemInstruction 
                });

                const response = await model.generateContent({
                    contents
                });
                // ------------------------------------

                const text = response.text;
                console.log(`✅ Cevap Başarılı (Model: ${usedModel}).`);
                logUsage(req.ip, usedModel, 'SUCCESS');
                return res.json({ reply: text, model: usedModel }); 

            } catch (err) {
                error = err;
                console.error(`🚨 Model Hatası (${usedModel}):`, err.message);
                
                if (!err.message.includes("429") && !err.message.includes("404")) {
                   // Model bulunamadı veya kota hatası değilse (örn. syntax hatası) döngüyü kırma, devam et
                }
            }
        }
        
        throw error || new Error("Tüm modeller meşgul.");

    } catch (error) {
        console.error("🚨 SERVER HATASI:", error.message);
        let userReply = "Bağlantıda küçük bir sorun oldu. Lütfen tekrar dene. 🤖";
        if (error.message.includes("429")) userReply = "Kota doldu, biraz bekleyip tekrar dene.";
        res.status(500).json({ reply: userReply, error: error.message });
    } finally {
        if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
        if (optimizedPath && fs.existsSync(optimizedPath)) fs.unlinkSync(optimizedPath);
    }
});

app.listen(PORT, () => console.log(`🚀 Divine Server ${PORT} portunda çalışıyor! Modeller: ${MODELS.join(', ')}`));
