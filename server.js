import http from "http";

const LM_API_URL = "http://localhost:1234/v1/chat/completions";

let messages = [
    { role: "system", content: "answer in the same language as the question" }
];

const server = http.createServer(async (req, res) => {
    // CORS configuration for local development
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === "POST" && req.url === "/chat") {
        let body = "";
        req.on("data", chunk => {
            body += chunk.toString();
        });

        req.on("end", async () => {
            try {
                const { text, maxLength } = JSON.parse(body);
                if (text) {
                    messages.push({ role: "user", content: text });
                }

                // AIに文字数制限を指示するシステムプロンプトを動的に追加
                const currentMessages = [...messages];
                if (maxLength) {
                    currentMessages.push({
                        role: "system",
                        content: `出力は必ず約${maxLength}文字以内に収め、簡潔に返答してください。`
                    });
                }

                const lmRes = await fetch(LM_API_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        model: "lfm-2.5-1.2b",
                        messages: currentMessages,
                        temperature: 0.7,
                        max_tokens: maxLength ? Math.floor(maxLength * 1.5) : undefined,
                        stream: true // ← ここが重要: LM Studioから少しずつデータをもらう
                    })
                });

                if (!lmRes.ok) {
                    throw new Error(`LM Studio returned status ${lmRes.status}`);
                }

                // チャンク転送をクライアントに指示
                res.writeHead(200, {
                    "Content-Type": "text/plain; charset=utf-8",
                    "Transfer-Encoding": "chunked"
                });

                const reader = lmRes.body.getReader();
                const decoder = new TextDecoder("utf-8");
                let fullReply = "";

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value);
                    const lines = chunk.split("\n").filter(l => l.trim() !== "");

                    for (const line of lines) {
                        if (line === "data: [DONE]") continue;

                        if (line.startsWith("data: ")) {
                            try {
                                const json = JSON.parse(line.slice(6));
                                const token = json.choices[0]?.delta?.content;

                                if (token) {
                                    fullReply += token;
                                    res.write(token); // ← テキストだけをストリームで送信する
                                }
                            } catch { }
                        }
                    }
                }

                messages.push({ role: "assistant", content: fullReply });
                res.end();
            } catch (error) {
                console.error("AI API Error:", error);
                if (!res.headersSent) {
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Failed to communicate with LM Studio API" }));
                } else {
                    res.end();
                }
            }
        });
        return;
    }

    res.writeHead(404);
    res.end("Not Found");
});

const PORT = 3001;
server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
    console.log("クライアントは index.html を開いてください。");
});