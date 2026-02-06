const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const sharp = require('sharp');
const { GoogleGenerativeAI } = require('@google/generative-ai');
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
} else {
    console.log("✅ API Key yüklendi (System Ready).");
}

// Logs klasörü oluştur
if (!fs.existsSync('logs')) fs.mkdirSync('logs');

// 2. MIDDLEWARE
app.use(cors());
app.use(express.json());

// 3. LOGLAMA
function logUsage(ip, model) {
    try {
        const date = new Date().toISOString().split('T')[0];
        const entry = `${new Date().toISOString()} | IP: ${ip} | Model: ${model}\n`;
        fs.appendFile(path.join('logs', `usage-${date}.log`), entry, () => {});
    } catch (e) { console.error("Log Error:", e); }
}

// 4. DOSYA YÜKLEME
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024 }
});

// 5. GEMINI AI KURULUMU (GÜNCELLENDİ)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Botun Kişiliği (System Instruction)
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

// Modeli Tanımla (Flash Modelini Ana Model Yaptık - Daha Kararlı)
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    systemInstruction: systemInstruction
});

// Health Check
app.get('/', (req, res) => res.json({ status: "Online", owner: "Furkan Senyuz" }));

// 6. CHAT ROTASI
app.post('/chat', upload.single('image'), async (req, res) => {
    try {
        console.log(`📩 Yeni Mesaj Geldi: IP ${req.ip}`);
        
        const userMsg = sanitizeHtml(req.body.message || "", { allowedTags: [] });
        
        // Resim İşleme
        let imagePart = null;
        if (req.file) {
            try {
                const optimizedPath = req.file.path + '-opt.jpg';
                await sharp(req.file.path).rotate().resize(800).jpeg({ quality: 80 }).toFile(optimizedPath);
                imagePart = {
                    inlineData: {
                        data: fs.readFileSync(optimizedPath).toString("base64"),
                        mimeType: "image/jpeg"
                    }
                };
                fs.unlinkSync(req.file.path);
                fs.unlinkSync(optimizedPath);
            } catch (err) { console.error("Resim İşleme Hatası:", err); }
        }

        // Gemini'ye Gönderilecek Mesaj
        // Not: System prompt artık modelin içinde, buraya sadece kullanıcı mesajını ekliyoruz.
        const parts = [];
        if (imagePart) parts.push(imagePart);
        parts.push(userMsg); // Kullanıcı metni

        // Yapay Zekaya Sor
        console.log("🤖 Gemini Flash Düşünüyor...");
        const result = await model.generateContent(parts);
        const response = await result.response;
        const text = response.text();
        
        console.log("✅ Cevap Üretildi.");
        logUsage(req.ip, 'FLASH');
        res.json({ reply: text, model: 'flash' });

    } catch (error) {
        console.error("🚨 SERVER HATASI (Detaylı):", error);
        
        // Hatanın detayını konsola yazdırıyoruz ki Render Log'da görebilelim
        if (error.response) {
            console.error("Google API Hatası:", JSON.stringify(error.response, null, 2));
        }
        
        res.status(500).json({ 
            reply: "Bağlantıda küçük bir sorun oldu. Lütfen tekrar dene. 🤖", 
            error: error.message 
        });
    }
});

app.listen(PORT, () => console.log(`🚀 Divine Server ${PORT} portunda çalışıyor!`));
