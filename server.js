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

// Botun Kişiliği (System Instruction)
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

// --- MODEL DİZİSİ (Fallback Sırası) ---
// 1. Gemini 3 Flash (preview, yüksek performans)
// 2. Gemini 2.5 Flash (stable, genel)
// 3. Gemini 2.5 Flash Lite (hafif, düşük kota)
// Eğer 404 alırsan, '-preview' veya '-latest' ekle (örneğin "gemini-3-flash-preview")
const MODELS = [
    "gemini-3-flash-preview",  // İlk tercih: Yüksek kaliteli
    "gemini-2.5-flash",        // İkinci: Dengeli
    "gemini-2.5-flash-lite"    // Üçüncü: Hafif fallback
];

// Health Check (Aktif modelleri göster)
app.get('/', (req, res) => res.json({ status: "Online", owner: "Furkan Senyuz", models: MODELS }));

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
                    generationConfig: { systemInstruction }  // System prompt config'de
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
