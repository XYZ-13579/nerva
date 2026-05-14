import http from "http";
import os from "os";

const LM_API_URL = "http://127.0.0.1:1234/v1/chat/completions";

let messages = [
    {
        role: "system",
        content: "answer in the same language as the question"
    }
];

// ローカルIP取得
function getLocalIP() {
    const interfaces = os.networkInterfaces();

    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]) {
            if (
                net.family === "IPv4" &&
                !net.internal
            ) {
                return net.address;
            }
        }
    }

    return "localhost";
}

const server = http.createServer(async (req, res) => {

    // ===== CORS =====
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    // ===== ROUTE =====
    if (req.method === "POST" && req.url === "/chat") {

        let body = "";

        req.on("data", chunk => {
            body += chunk.toString();

            // 過剰データ防止
            if (body.length > 1e6) {
                req.socket.destroy();
            }
        });

        req.on("end", async () => {

            try {

                const parsed = JSON.parse(body);

                const text = parsed.text || "";
                const maxLength = parsed.maxLength || 200;

                if (text.trim()) {
                    messages.push({
                        role: "user",
                        content: text
                    });
                }

                // 送信用メッセージ
                const currentMessages = [...messages];

                currentMessages.push({
                    role: "system",
                    content: `出力は約${maxLength}文字程度にしてください。`
                });

                console.log("User:", text);

                const lmRes = await fetch(LM_API_URL, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: "liquid/lfm2.5-1.2b",
                        messages: currentMessages,
                        temperature: 0.7,
                        max_tokens: Math.floor(maxLength * 1.5),
                        stream: true
                    })
                });

                if (!lmRes.ok) {
                    throw new Error(
                        `LM Studio Error ${lmRes.status}`
                    );
                }

                // ===== STREAM RESPONSE =====
                res.writeHead(200, {
                    "Content-Type": "text/plain; charset=utf-8",
                    "Transfer-Encoding": "chunked"
                });

                const reader = lmRes.body.getReader();
                const decoder = new TextDecoder("utf-8");

                let fullReply = "";

                while (true) {

                    const { done, value } =
                        await reader.read();

                    if (done) break;

                    const chunk =
                        decoder.decode(value);

                    const lines = chunk
                        .split("\n")
                        .filter(line => line.trim());

                    for (const line of lines) {

                        if (line === "data: [DONE]") {
                            continue;
                        }

                        if (line.startsWith("data: ")) {

                            try {

                                const json = JSON.parse(
                                    line.slice(6)
                                );

                                const token =
                                    json.choices?.[0]
                                        ?.delta?.content;

                                if (token) {

                                    fullReply += token;

                                    // クライアントへ逐次送信
                                    res.write(token);
                                }

                            } catch (err) {
                                console.error(
                                    "Chunk Parse Error:",
                                    err.message
                                );
                            }
                        }
                    }
                }

                messages.push({
                    role: "assistant",
                    content: fullReply
                });

                console.log("Assistant:", fullReply);

                res.end();

            } catch (error) {

                console.error(
                    "Server Error:",
                    error
                );

                if (!res.headersSent) {

                    res.writeHead(500, {
                        "Content-Type":
                            "application/json"
                    });

                    res.end(JSON.stringify({
                        error:
                            "Failed to communicate with LM Studio API"
                    }));

                } else {
                    res.end();
                }
            }
        });

        return;
    }

    // ===== NOT FOUND =====
    res.writeHead(404, {
        "Content-Type": "text/plain"
    });

    res.end("Not Found");
});

// ===== SERVER START =====
const PORT = 3001;
const HOST = "0.0.0.0";

server.listen(PORT, HOST, () => {

    const localIP = getLocalIP();

    console.log("");
    console.log("=== SERVER STARTED ===");
    console.log(`Local   : http://localhost:${PORT}`);
    console.log(`Network : http://localhost:${PORT}`);
    console.log("");

    console.log("スマホなど別デバイスでは:");
    console.log(
        `http://IPアドレス:${PORT}`
    );
});
