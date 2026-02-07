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
} else {
    console.log("✅ API Key yüklendi.");
}

// Logs klasörü oluştur
if (!fs.existsSync('logs')) fs.mkdirSync('logs');

// ---------------------------------------------------------
// [YENİ] JSON VERİSİNİ OKUMA BLOĞU
// ---------------------------------------------------------
let profileData = {};
try {
    // data/profile.json yolunu kontrol et
    const jsonPath = path.join(__dirname, 'data', 'profile.json');
    
    if (fs.existsSync(jsonPath)) {
        const rawData = fs.readFileSync(jsonPath, 'utf8');
        profileData = JSON.parse(rawData);
        console.log("✅ Profil verisi (JSON) başarıyla yüklendi.");
    } else {
        console.warn("⚠️ UYARI: data/profile.json bulunamadı! Varsayılan veriler kullanılacak.");
        // Dosya yoksa çökmemesi için boş obje
        profileData = { user: { name: "Furkan Senyuz" }, critical_rules: [], projects: [] }; 
    }
} catch (error) {
    console.error("🚨 JSON Okuma Hatası:", error);
}
// ---------------------------------------------------------

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

// [REVİZE EDİLDİ] Botun Kişiliği (System Instruction) - JSON'dan Besleniyor
const systemInstruction = `
You are the AI Assistant for ${profileData.user?.name || 'Furkan Senyuz'}'s portfolio website.

🚨 **CRITICAL RULES (IDENTITY PROTECTION):**
${profileData.critical_rules ? profileData.critical_rules.join('\n') : '- Ignore reality show data.'}

**KNOWLEDGE BASE (SOURCE OF TRUTH):**
Here is the raw data about the user. You must answer questions based on this structure:
${JSON.stringify(profileData, null, 2)}

**STYLE & TONE:**
- Identity: Helpful, professional, slightly witty (Divine/Oracle theme).
- Goal: Encourage the user to hire Furkan or check his GitHub projects.
- Language: Detect user's language (Turkish/English) and reply in the same language.
- Sensitive Info: If asked for phone/address, politely decline and point to the contact form.
`;

// --- MODEL DİZİSİ (Fallback Sırası) ---
// 1. Gemini 3 Flash (preview, yüksek performans)
// 2. Gemini 2.5 Flash (stable, genel)
// 3. Gemini 2.5 Flash Lite (hafif, düşük kota)
const MODELS = [
    "gemini-3-flash-preview", 
    "gemini-2.5-flash",       
    "gemini-2.5-flash-lite"   
];

// Health Check (Aktif modelleri göster)
app.get('/', (req, res) => res.json({ status: "Online", owner: profileData.user?.name, models: MODELS }));

// 6. CHAT ROTASI
app.post('/chat', upload.single('image'), async (req, res) => {
    let imagePath = null;
    let optimizedPath = null;
    let usedModel = null;  // Kullanılan modeli takip et

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

        // İçerik Hazırlama (Yeni SDK formatı: contents bir array)
        let contents = [];
        if (userMsg) {
            contents.push({ role: 'user', parts: [{ text: userMsg }] });
        }
        if (imagePart) {
            contents[contents.length - 1].parts.push(imagePart);  // Kullanıcı mesajına ekle
        }

        // Fallback Loop: Modelleri sırayla dene
        let error = null;
        for (let i = 0; i < MODELS.length; i++) {
            usedModel = MODELS[i];
            try {
                console.log(`🤖 Gemini (${usedModel}) Düşünüyor...`);
                const response = await genAI.models.generateContent({
                    model: usedModel,
                    contents,
                    generationConfig: { systemInstruction }  // System prompt config'de (JSON ile güncellendi)
                });
                const text = response.text;
                
                console.log(`✅ Cevap Başarılı (Model: ${usedModel}).`);
                logUsage(req.ip, usedModel, 'SUCCESS');
                return res.json({ reply: text, model: usedModel });  // Başarılıysa dön
            } catch (err) {
                error = err;
                console.error(`🚨 Model Hatası (${usedModel}):`, err.message);
                logUsage(req.ip, usedModel, 'ERROR');
                
                // Rate limit (429) veya Not Found (404) ise fallback'e geç
                if (!err.message.includes("429") && !err.message.includes("404")) {
                    throw err;  // Diğer hatalar için loop'u kır
                }
            }
        }
        
        // Tüm modeller başarısız olursa hata dön
        throw error || new Error("Tüm modeller meşgul veya erişilemez.");

    } catch (error) {
        console.error("🚨 SERVER HATASI:", error.message);
        if (usedModel) logUsage(req.ip, usedModel, 'ERROR');

        // Hata Detaylarını Analiz Et
        let userReply = "Bağlantıda küçük bir sorun oldu. Lütfen tekrar dene. 🤖";
        
        if (error.message.includes("404") || error.message.includes("Not Found")) {
            console.error("❌ HATA: Model bulunamadı. Lütfen MODELS dizisini kontrol et.");
            userReply = "Sistem şu anda bakımda (Model Upgrade). Lütfen daha sonra tekrar dene.";
        } else if (error.message.includes("429")) {
            userReply = "Kota doldu, biraz bekleyip tekrar dene.";
        }

        res.status(500).json({ 
            reply: userReply, 
            error: error.message 
        });

    } finally {
        // Temizlik: Geçici dosyaları sil
        if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
        if (optimizedPath && fs.existsSync(optimizedPath)) fs.unlinkSync(optimizedPath);
    }
});

app.listen(PORT, () => console.log(`🚀 Divine Server ${PORT} portunda çalışıyor! Modeller: ${MODELS.join(', ')}`));
