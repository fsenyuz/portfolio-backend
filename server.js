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

// Logs klasörü yoksa oluştur
if (!fs.existsSync('logs')) {
    fs.mkdirSync('logs');
}

// 2. GÜVENLİK VE MIDDLEWARE
app.use(cors());
app.use(express.json());

// Clickjacking Koruması (Divine Shield)
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    next();
});

// 3. LOGLAMA SİSTEMİ (Günlük Dosya)
function logUsage(ip, model) {
    try {
        const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const entry = `${new Date().toISOString()} | IP: ${ip} | Model: ${model}\n`;
        fs.appendFile(path.join('logs', `usage-${date}.log`), entry, (err) => {
            if (err) console.error("Log Error:", err);
        });
    } catch (e) {
        console.error("Log System Error:", e);
    }
}

// 4. DOSYA YÜKLEME AYARLARI (Multer)
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB Limit
});

// 5. GEMINI AI KURULUMU
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const modelPro = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
const modelFlash = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Sistem Promptu (Kişilik)
const sysPrompt = `
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

// 6. CHAT ROTASI (ANA İŞLEV)
app.post('/chat', upload.single('image'), async (req, res) => {
    try {
        console.log(`[Request] Chat request from IP: ${req.ip}`);
        
        // Kullanıcı mesajını temizle (Güvenlik)
        const userMsg = sanitizeHtml(req.body.message || "", { allowedTags: [] });
        
        // Görüntü İşleme (Varsa)
        let imagePart = null;
        if (req.file) {
            try {
                const optimizedPath = req.file.path + '-opt.jpg';
                // Sharp: Metadata sil, yönü düzelt, 800px'e küçült
                await sharp(req.file.path)
                    .rotate()
                    .resize(800)
                    .jpeg({ quality: 80 })
                    .toFile(optimizedPath);
                
                const mimeType = "image/jpeg";
                const imageBuffer = fs.readFileSync(optimizedPath);
                imagePart = {
                    inlineData: {
                        data: imageBuffer.toString("base64"),
                        mimeType
                    }
                };
                
                // Temizlik
                fs.unlinkSync(req.file.path);
                fs.unlinkSync(optimizedPath);
            } catch (err) {
                console.error("Image Process Error:", err);
            }
        }

        // Prompt Hazırlığı
        const parts = [sysPrompt, `User: ${userMsg}`];
        if (imagePart) parts.push(imagePart);

        // Model Seçimi ve Yanıt (Fallback Mekanizması)
        try {
            // Önce Pro Modelini Dene
            const result = await modelPro.generateContent(parts);
            const response = await result.response;
            const text = response.text();
            
            logUsage(req.ip, 'PRO');
            res.json({ reply: text, model: 'pro' });

        } catch (error) {
            console.warn("Pro Model Failed, switching to Flash:", error.message);
            // Hata olursa Flash Modelini Dene (Daha hızlı/ucuz)
            const result = await modelFlash.generateContent(parts);
            const response = await result.response;
            const text = response.text();
            
            logUsage(req.ip, 'FLASH');
            res.json({ reply: text, model: 'flash' });
        }

    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ reply: "My circuits are overheated. Please try again later. 🤖", error: error.message });
    }
});

// 7. SUNUCUYU BAŞLAT
app.listen(PORT, () => {
    console.log(`Divine Server is running on port ${PORT} 🚀`);
});
