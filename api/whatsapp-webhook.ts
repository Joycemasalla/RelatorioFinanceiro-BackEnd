import mongoose, { Schema, Document } from 'mongoose';
import { Request, Response } from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const API_TOKEN = process.env.WHATSAPP_API_TOKEN;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const MONGO_URI = process.env.MONGO_URI;

// **CORREÇÃO: Conexão com o MongoDB fora do handler**
if (mongoose.connection.readyState === 0) {
    mongoose.connect(MONGO_URI!)
        .then(() => console.log('Conectado ao MongoDB Atlas'))
        .catch(err => console.error('Erro ao conectar com o MongoDB', err));
}

// Modelos (Movidos para dentro da função para evitar problemas de importação)
interface ITransaction extends Document {
  userId: string;
  type: 'income' | 'expense';
  amount: number;
  description: string;
  category: string;
  date: Date;
}
const TransactionSchema: Schema = new Schema({
  userId: { type: String, required: true },
  type: { type: String, enum: ['income', 'expense'], required: true },
  amount: { type: Number, required: true },
  description: { type: String, required: true },
  category: { type: String, required: true },
  date: { type: Date, default: Date.now },
});
const Transaction = mongoose.models.Transaction || mongoose.model<ITransaction>('Transaction', TransactionSchema);

interface IUserMapping extends Document {
  waId: string;
  dashboardUserId: string;
}
const UserMappingSchema: Schema = new Schema({
  waId: { type: String, required: true, unique: true },
  dashboardUserId: { type: String, required: true, unique: true },
});
const UserMapping = mongoose.models.UserMapping || mongoose.model<IUserMapping>('UserMapping', UserMappingSchema);

// Utilidades (Movidas para dentro da função)
const getCategoryFromDescription = (description: string): string => {
    const lowerCaseDesc = description.toLowerCase();
    if (lowerCaseDesc.includes('mercado') || lowerCaseDesc.includes('supermercado') || lowerCaseDesc.includes('compras')) return 'Mercado';
    if (lowerCaseDesc.includes('salario') || lowerCaseDesc.includes('pagamento')) return 'Salário';
    if (lowerCaseDesc.includes('restaurante') || lowerCaseDesc.includes('lanchonete')) return 'Alimentação';
    if (lowerCaseDesc.includes('transporte') || lowerCaseDesc.includes('combustível')) return 'Transporte';
    if (lowerCaseDesc.includes('lazer') || lowerCaseDesc.includes('cinema') || lowerCaseDesc.includes('viagem')) return 'Lazer';
    if (lowerCaseDesc.includes('saude') || lowerCaseDesc.includes('farmacia') || lowerCaseDesc.includes('medico')) return 'Saúde';
    if (lowerCaseDesc.includes('moradia') || lowerCaseDesc.includes('aluguel') || lowerCaseDesc.includes('condominio')) return 'Moradia';
    return 'Outros';
};

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