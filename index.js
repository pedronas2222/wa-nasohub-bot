const qrcode = require("qrcode-terminal");
const express = require("express");
const cors = require("cors");
const { Client, LocalAuth } = require("whatsapp-web.js");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(cors());

// const client = new Client({ authStrategy: new LocalAuth() });

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true, // Use true se não precisar ver a interface
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage', 
            '--disable-software-rasterizer',
            '--remote-debugging-port=9222',
        ],
    },
});



client.on("qr", qr => {
    console.log("📌 Escaneie o QR Code para conectar:");
    qrcode.generate(qr, { small: true });
});

client.on("authenticated", () => {
    console.log("✅ Cliente autenticado!");
});

client.on("ready", () => {
    console.log("✅ Bot do WhatsApp está pronto e conectado!");
});

client.on("disconnected", (reason) => {
    console.log("❌ Cliente desconectado:", reason);
});

client.on("message", msg => {
    console.log("📩 Mensagem recebida:", msg.body);
    io.emit("message", { from: msg.from, body: msg.body });

    if (msg.body.toLowerCase() === "oi") {
        msg.reply("Olá! Como posso te ajudar?");
    }
});

client.initialize();

app.post("/send-message", async (req, res) => {
    const { number, message } = req.body;

    if (!number || !message) {
        return res.status(400).json({ error: "Número e mensagem são obrigatórios!" });
    }

    const chatId = `${number.replace(/\D/g, "")}@c.us`; // Remove tudo que não for número

    try {
        if (!client.info) {
            return res.status(500).json({ error: "Cliente do WhatsApp não está pronto!" });
        }

        await client.sendMessage(chatId, message);
        console.log("✅ Mensagem enviada para:", chatId);
        res.json({ success: true, message: `Mensagem enviada para ${number}` });
    } catch (error) {
        console.error("❌ Erro ao enviar mensagem:", error);
        res.status(500).json({ error: "Erro ao enviar mensagem", details: error.message });
    }
});

// Inicia o servidor com WebSockets
server.listen(3000, () => console.log("🔥 API rodando na porta 3000"));
