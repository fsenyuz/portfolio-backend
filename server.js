// ... imports ...
app.use((req, res, next) => {
    // Clickjacking Protection (Divine Shield)
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    next();
});

// Simple Log Rotation
function logUsage(ip, model) {
    const date = new Date().toISOString().split('T')[0]; // Daily file
    const entry = `${new Date().toISOString()} | ${ip} | ${model}\n`;
    fs.appendFile(`logs/usage-${date}.log`, entry, () => {});
}

// ... Chat logic ...