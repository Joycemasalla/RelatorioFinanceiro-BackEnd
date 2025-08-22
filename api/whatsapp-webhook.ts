import { Router, Request, Response } from 'express';

export default async function handler (req: Request, res: Response) {
  if (req.method === "GET") {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(challenge || "");
    } else {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
    }
  } else if (req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      console.log("📩 Webhook recebido:", body);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "EVENT_RECEIVED" }));
    });
  } else {
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method Not Allowed");
  }
}
