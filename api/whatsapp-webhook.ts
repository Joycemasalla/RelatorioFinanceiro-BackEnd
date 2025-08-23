import mongoose, { Schema, Document } from 'mongoose';
import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

const API_TOKEN = process.env.WHATSAPP_API_TOKEN;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const MONGO_URI = process.env.MONGO_URI;

// Interfaces
interface ITransaction extends Document {
  userId: string;
  type: 'income' | 'expense';
  amount: number;
  description: string;
  category: string;
  createdAt: Date;
}

interface IUserMapping extends Document {
  waId: string;
  dashboardUserId: string;
}

// Schemas
const TransactionSchema: Schema = new Schema({
  userId: { type: String, required: true },
  type: { type: String, enum: ['income', 'expense'], required: true },
  amount: { type: Number, required: true },
  description: { type: String, required: true },
  category: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const UserMappingSchema: Schema = new Schema({
  waId: { type: String, required: true, unique: true },
  dashboardUserId: { type: String, required: true, unique: true },
});

// Models
const Transaction = mongoose.models.Transaction || mongoose.model<ITransaction>('Transaction', TransactionSchema);
const UserMapping = mongoose.models.UserMapping || mongoose.model<IUserMapping>('UserMapping', UserMappingSchema);

// Utility function
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

// MongoDB connection with cache
let cachedConnection: typeof mongoose | null = null;

const connectToDatabase = async () => {
  if (cachedConnection) {
    return cachedConnection;
  }

  if (!MONGO_URI) {
    throw new Error('MONGO_URI não definida nas variáveis de ambiente');
  }

  try {
    const connection = await mongoose.connect(MONGO_URI);
    cachedConnection = connection;
    return connection;
  } catch (error) {
    console.error('Erro ao conectar com MongoDB:', error);
    throw error;
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    await connectToDatabase();

    if (req.method === 'GET') {
      // Webhook verification
      const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;

      console.log('Webhook verification:', { mode, token: token ? 'present' : 'missing', challenge });

      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('Webhook verified successfully!');
        return res.status(200).send(challenge as string);
      } else {
        console.log('Webhook verification failed');
        return res.status(403).send('Forbidden');
      }
    }

    if (req.method === 'POST') {
      const data = req.body;

      if (!data || data.object !== 'whatsapp_business_account') {
        return res.status(400).json({ error: 'Invalid data' });
      }

      // Process messages
      for (const entry of data.entry || []) {
        for (const change of entry.changes || []) {
          if (change.value?.messages) {
            for (const message of change.value.messages) {
              const incomingMessage = message.text?.body;
              const waId = message.from;

              if (!incomingMessage || !waId) {
                continue;
              }

              const lowerCaseMessage = incomingMessage.toLowerCase().trim();

              // User mapping management
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

              // Send message function
              const sendMessage = async (body: string) => {
                if (!API_TOKEN) {
                  console.error('WhatsApp API token not configured');
                  return;
                }

                try {
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
                } catch (error) {
                  console.error('Error sending message:', error);
                }
              };

              // Process commands
              if (lowerCaseMessage === 'ajuda' || lowerCaseMessage === 'comandos') {
                const replyMessage = "Comandos disponíveis:\n\n" +
                  "• Registrar despesa: '50 no mercado'\n" +
                  "• Registrar receita: 'recebi 1000 salário'\n" +
                  "• Relatório: 'relatório de hoje' ou 'relatório do mês'\n" +
                  "• Ver dashboard: 'dashboard'\n" +
                  "• Apagar transação: 'apagar [ID da transação]'";
                await sendMessage(replyMessage);
                continue;
              }

              // Process transaction
              const generalRegex = /(\d+[\.,]?\d*)\s*(.*)/i;
              const incomeKeywords = ['recebi', 'receita', 'ganho', 'salário'];
              const match = incomingMessage.match(generalRegex);

              if (match) {
                const amount = parseFloat(match[1].replace(',', '.'));
                const description = match[2]?.trim() || 'Transação';
                const type = incomeKeywords.some(keyword => lowerCaseMessage.includes(keyword)) ? 'income' : 'expense';
                const category = getCategoryFromDescription(description);

                const newTransaction = new Transaction({ userId, type, amount, description, category });
                await newTransaction.save();

                const confirmationMessage = `Transação salva com sucesso!\nDetalhes:\n- Tipo: ${type === 'expense' ? 'Gasto' : 'Receita'}\n- Valor: R$ ${amount.toFixed(2)}\n- Descrição: ${description}\n- Categoria: ${category}\n- ID: ${newTransaction._id}`;

                await sendMessage(confirmationMessage);
              } else {
                await sendMessage("Não entendi sua solicitação. Envie 'ajuda' para ver a lista de comandos.");
              }
            }
          }
        }
      }

      return res.status(200).json({ status: 'success' });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}