const qrcode = require("qrcode-terminal");
const express = require("express");
const cors = require("cors");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(cors());

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage', 
            '--disable-software-rasterizer',
            '--remote-debugging-port=9222',
        ],
    },
});

let isClientReady = false;
const chats = new Map(); // Armazena os chats (contatos que enviaram mensagens)
const messageHistory = new Map(); // Armazena o histórico de mensagens
const userStates = new Map(); // Armazena o estado de cada usuário

client.on("qr", qr => {
    console.log("📌 Escaneie o QR Code para conectar:");
    qrcode.generate(qr, { small: true });
});

client.on("authenticated", () => {
    console.log("✅ Cliente autenticado!");
});

client.on("ready", () => {
    console.log("✅ Bot do WhatsApp está pronto e conectado!");
    isClientReady = true;
});

client.on("disconnected", (reason) => {
    console.log("❌ Cliente desconectado:", reason);
    isClientReady = false;
});

client.on("message", async (msg) => {
    const contact = await msg.getContact();
    const userId = msg.from; // Identificador único do usuário
    const userMessage = msg.body.toLowerCase(); // Mensagem do usuário em minúsculas

    // Verifica o estado atual do usuário
    let userState = userStates.get(userId) || { step: "start" };

    // Lógica do fluxo de conversa
    switch (userState.step) {
        case "start":
            // Passo 1: Pergunta o nome do usuário
            await msg.reply("Olá! Qual é o seu nome?");
            userState.step = "ask_name"; // Atualiza o estado
            break;

        case "ask_name":
            // Passo 2: Salva o nome e pergunta sobre o serviço
            userState.name = userMessage; // Salva o nome
            await msg.reply(`Prazer, ${userMessage}! Como posso ajudar você hoje? Escolha uma opção:
            1️⃣ - Suporte técnico
            2️⃣ - Informações sobre serviços
            3️⃣ - Falar com um atendente`);
            userState.step = "ask_service"; // Atualiza o estado
            break;

        case "ask_service":
            // Passo 3: Processa a escolha do serviço
            if (userMessage === "1" || userMessage.includes("suporte")) {
                await msg.reply("Você escolheu *Suporte técnico*. Por favor, descreva o problema.");
                userState.step = "support_description"; // Atualiza o estado
            } else if (userMessage === "2" || userMessage.includes("informações")) {
                await msg.reply("Você escolheu *Informações sobre serviços*. Aqui estão nossas opções:\n- Serviço A\n- Serviço B\n- Serviço C");
                userState.step = "start"; // Reinicia o fluxo
            } else if (userMessage === "3" || userMessage.includes("atendente")) {
                await msg.reply("Você escolheu *Falar com um atendente*. Um atendente entrará em contato em breve.");
                userState.step = "start"; // Reinicia o fluxo
            } else {
                await msg.reply("Opção inválida. Por favor, escolha 1, 2 ou 3.");
            }
            break;

        case "support_description":
            // Passo 4: Salva a descrição do problema e finaliza
            await msg.reply("Obrigado por descrever o problema. Nossa equipe entrará em contato em breve.");
            console.log(`Problema relatado por ${userState.name}: ${userMessage}`);
            userState.step = "start"; // Reinicia o fluxo
            break;

        default:
            await msg.reply("Algo deu errado. Vamos começar de novo.");
            userState.step = "start"; // Reinicia o fluxo
    }

    // Atualiza o estado do usuário
    userStates.set(userId, userState);

    // Adiciona o chat à lista (se ainda não estiver)
    const chat = { from: msg.from, name: contact.pushname || contact.name, photo: contact.profilePicUrl };
    if (!chats.has(msg.from)) {
        chats.set(msg.from, chat);
        io.emit("newChat", chat); // Notifica o frontend sobre um novo chat
    }

    // Adiciona a mensagem do usuário ao histórico
    if (!messageHistory.has(msg.from)) {
        messageHistory.set(msg.from, []);
    }
    messageHistory.get(msg.from).push({ from: msg.from, body: msg.body, type: "user" });

    // Envia a mensagem do usuário para o frontend
    io.emit("message", { from: msg.from, body: msg.body, type: "user" });

    // Envia as respostas do bot para o frontend
    if (userState.step === "ask_name") {
        io.emit("message", { from: "bot", body: "Olá! Qual é o seu nome?", type: "bot" });
    } else if (userState.step === "ask_service") {
        io.emit("message", { from: "bot", body: `Prazer, ${userState.name}! Como posso ajudar você hoje? Escolha uma opção:
        1️⃣ - Suporte técnico
        2️⃣ - Informações sobre serviços
        3️⃣ - Falar com um atendente`, type: "bot" });
    } else if (userState.step === "support_description") {
        io.emit("message", { from: "bot", body: "Você escolheu *Suporte técnico*. Por favor, descreva o problema.", type: "bot" });
    } else if (userState.step === "start" && userMessage === "2") {
        io.emit("message", { from: "bot", body: "Você escolheu *Informações sobre serviços*. Aqui estão nossas opções:\n- Serviço A\n- Serviço B\n- Serviço C", type: "bot" });
    } else if (userState.step === "start" && userMessage === "3") {
        io.emit("message", { from: "bot", body: "Você escolheu *Falar com um atendente*. Um atendente entrará em contato em breve.", type: "bot" });
    } else if (userState.step === "start" && userMessage === "1") {
        io.emit("message", { from: "bot", body: "Você escolheu *Suporte técnico*. Por favor, descreva o problema.", type: "bot" });
    } else if (userState.step === "start") {
        io.emit("message", { from: "bot", body: "Opção inválida. Por favor, escolha 1, 2 ou 3.", type: "bot" });
    }
});

client.initialize();

// Endpoint para enviar mensagens
app.post("/send-message", async (req, res) => {
    const { number, message } = req.body;

    if (!number || !message) {
        return res.status(400).json({ error: "Número e mensagem são obrigatórios!" });
    }

    const chatId = `${number.replace(/\D/g, "")}@c.us`;

    try {
        if (!isClientReady) {
            return res.status(500).json({ error: "Cliente do WhatsApp não está conectado!" });
        }

        const isRegistered = await client.isRegisteredUser(chatId);
        if (!isRegistered) {
            return res.status(400).json({ error: "O número não está registrado no WhatsApp!" });
        }

        await client.sendMessage(chatId, message);
        console.log("✅ Mensagem enviada para:", chatId);
        res.json({ success: true, message: `Mensagem enviada para ${number}` });
    } catch (error) {
        console.error("❌ Erro ao enviar mensagem:", error);
        res.status(500).json({ error: "Erro ao enviar mensagem", details: error.message });
    }
});

// Socket.IO: Envia a lista de chats e o histórico de mensagens para o frontend
io.on("connection", (socket) => {
    console.log("Novo cliente conectado");

    // Envia a lista de chats ao frontend
    socket.emit("chats", Array.from(chats.values()));

    // Envia o histórico de mensagens de um chat específico
    socket.on("getMessages", (from) => {
        const messages = messageHistory.get(from) || [];
        socket.emit("messages", messages);
    });

    // Envia uma mensagem manualmente
    socket.on("sendMessage", async ({ to, message }) => {
        try {
            await client.sendMessage(to, message);
            console.log("✅ Mensagem enviada para:", to);
        } catch (error) {
            console.error("❌ Erro ao enviar mensagem:", error);
        }
    });

    // Envia um arquivo manualmente
    socket.on("sendFile", async ({ to, file, fileName, fileType }) => {
        try {
            const media = new MessageMedia(fileType, file.split(",")[1], fileName);
            await client.sendMessage(to, media);
            console.log("✅ Arquivo enviado para:", to);
        } catch (error) {
            console.error("❌ Erro ao enviar arquivo:", error);
        }
    });
});

server.listen(3000, () => console.log("🔥 API rodando na porta 3000"));