import { Request, Response } from 'express';
import { Transaction, ITransaction } from '../src/models/Transaction';
import { UserMapping, IUserMapping } from '../src/models/UserMapping';
import { getCategoryFromDescription } from '../src/utils/categoryUtils';
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import dotenv from 'dotenv';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const API_TOKEN = process.env.WHATSAPP_API_TOKEN;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

// Handler principal para a função serverless
export default async function handler(req: Request, res: Response) {
  if (req.method === "GET") {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log('Webhook verificado!');
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(challenge || "");
    } else {
      console.log('Webhook de verificação falhou.');
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
    }
  } else if (req.method === "POST") {
    const data = req.body;
    
    if (data && data.object === 'whatsapp_business_account') {
      try {
        for (const entry of data.entry) {
          for (const change of entry.changes) {
            if (change.value.messages) {
              for (const message of change.value.messages) {
                const incomingMessage = message.text?.body;
                const waId = message.from;
                
                if (!incomingMessage || !waId) {
                  return res.status(400).send('Mensagem ou WaId inválido.');
                }
                
                const lowerCaseMessage = incomingMessage.toLowerCase().trim();
                
                let userMapping = await UserMapping.findOne({ waId });
                let userId;

                if (!userMapping) {
                  const newDashboardUserId = uuidv4();
                  userMapping = new UserMapping({ waId, dashboardUserId: newDashboardUserId });
                  await userMapping.save();
                  userId = newDashboardUserId;
                } else {
                  userId = userMapping.dashboardUserId;
                }

                const sendMessage = async (body: string) => {
                  const url = `https://graph.facebook.com/v20.0/${change.value.metadata.phone_number_id}/messages`;
                  await axios.post(url, {
                    messaging_product: 'whatsapp',
                    to: waId,
                    text: { body },
                  }, {
                    headers: {
                      'Authorization': `Bearer ${API_TOKEN}`,
                      'Content-Type': 'application/json',
                    },
                  });
                };
                
                if (lowerCaseMessage === 'ajuda' || lowerCaseMessage === 'comandos') {
                  const replyMessage = "Comandos disponíveis:\n\n" +
                    "• Registrar despesa: '50 no mercado'\n" +
                    "• Registrar receita: 'recebi 1000 salário'\n" +
                    "• Relatório: 'relatório de hoje' ou 'relatório do mês'\n" +
                    "• Ver dashboard: 'dashboard'\n" +
                    "• Apagar transação: 'apagar [ID da transação]'";
                  await sendMessage(replyMessage);
                  return res.status(200).send('Webhook received - help command processed');
                }
                
                // Lógica de Criação de Transação
                const generalRegex = /(\d+[\.,]?\d*)\s*(.*)/i;
                const incomeKeywords = ['recebi', 'receita', 'ganho', 'salário'];

                let type: 'income' | 'expense' | null = null;
                let amount: number | null = null;
                let description: string | null = null;
                const match = incomingMessage.match(generalRegex);

                if (match) {
                  amount = parseFloat(match[1].replace(',', '.'));
                  description = match[2]?.trim() || 'Transação';

                  if (incomeKeywords.some(keyword => lowerCaseMessage.includes(keyword))) {
                    type = 'income';
                  } else {
                    type = 'expense';
                  }

                  const category = getCategoryFromDescription(description ?? 'Transação');

                  const newTransaction = new Transaction({ userId, type, amount, description, category });
                  await newTransaction.save();

                  const confirmationMessage = `Transação salva com sucesso!\nDetalhes:\n- Tipo: ${type === 'expense' ? 'Gasto' : 'Receita'}\n- Valor: R$ ${amount.toFixed(2)}\n- Descrição: ${description}\n- Categoria: ${category}\n- ID: ${newTransaction._id}`;
                  
                  await sendMessage(confirmationMessage);
                  return res.status(200).send('Webhook received - transaction saved');
                } else {
                  await sendMessage("Não entendi sua solicitação. Envie 'ajuda' para ver a lista de comandos.");
                  return res.status(400).send('Invalid message format');
                }
              }
            }
          }
        }
      } catch (error) {
        console.error('Erro ao processar webhook do WhatsApp:', error);
        res.status(500).send('Server error');
      }
    }
  } else {
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method Not Allowed");
  }
}