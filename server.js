const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const sharp = require('sharp');
const { GoogleGenAI } = require('@google/genai');  // Yeni SDK
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
    origin: '*', // Prodüksiyonda bunu fsenyuz.com olarak kısıtlamanı öneririm
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

// Botun Kişiliği (System Instruction) - Yeni SDK'de generateContent içinde geçer
const systemInstruction = `
You are the AI Assistant for Furkan Senyuz's portfolio website.
Identity: You are a helpful, professional, and slightly witty AI assistant.
Knowledge: You know that Furkan is a Civil Engineer & AI Solutions Developer.
Style: Be concise, engaging, and encourage the user to hire Furkan or look at his projects.
Key Info:
- Furkan combines Civil Engineering with Python/AI.
- He worked at Tasyapi (Serbia), Fernas, Limak.
- He knows Python, SQL, Primavera P6, TILOS.
- Current location: Kuzmin, Serbia.
If asked about sensitive info (phone, address), politely decline.
`;

// --- MODEL SEÇİMİ ---
// 2026 itibariyle kararlı sürüm: gemini-2.5-flash
// Eğer 404 alırsan 'gemini-2.5-flash-latest' dene.
const MODEL_NAME = "gemini-2.5-flash"; 

// Health Check
app.get('/', (req, res) => res.json({ status: "Online", owner: "Furkan Senyuz", model: MODEL_NAME }));

// 6. CHAT ROTASI
app.post('/chat', upload.single('image'), async (req, res) => {
    let imagePath = null;
    let optimizedPath = null;

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

        // Yapay Zekaya Sor (Yeni SDK: generateContent direkt çağrılır, systemInstruction config'de)
        console.log(`🤖 Gemini (${MODEL_NAME}) Düşünüyor...`);
        const response = await genAI.models.generateContent({
            model: MODEL_NAME,
            contents,
            generationConfig: { systemInstruction }  // System prompt config'de
        });
        const text = response.text;
        
        console.log("✅ Cevap Başarılı.");
        logUsage(req.ip, MODEL_NAME, 'SUCCESS');
        res.json({ reply: text, model: MODEL_NAME });

    } catch (error) {
        console.error("🚨 SERVER HATASI:", error.message);
        logUsage(req.ip, MODEL_NAME, 'ERROR');

        // Hata Detaylarını Analiz Et
        let userReply = "Bağlantıda küçük bir sorun oldu. Lütfen tekrar dene. 🤖";
        
        if (error.message.includes("404") || error.message.includes("Not Found")) {
            console.error("❌ HATA: Model bulunamadı. Lütfen server.js içindeki MODEL_NAME değişkenini kontrol et.");
            userReply = "Sistem şu anda bakımda (Model Upgrade). Lütfen daha sonra tekrar dene.";
        } else if (error.message.includes("429")) {
            userReply = "Çok fazla istek geldi, biraz bekleyip tekrar dene.";
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

app.listen(PORT, () => console.log(`🚀 Divine Server ${PORT} portunda çalışıyor! Model: ${MODEL_NAME}`));
