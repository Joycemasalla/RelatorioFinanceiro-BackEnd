import mongoose, { Schema, Document } from 'mongoose';
import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

const API_TOKEN = process.env.WHATSAPP_API_TOKEN;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const MONGO_URI = process.env.MONGO_URI;

console.log('Environment check:', {
  hasApiToken: !!API_TOKEN,
  hasVerifyToken: !!VERIFY_TOKEN,
  hasMongoUri: !!MONGO_URI
});

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
  if (lowerCaseDesc.includes('salario') || lowerCaseDesc.includes('pagamento') || lowerCaseDesc.includes('salário')) return 'Salário';
  if (lowerCaseDesc.includes('restaurante') || lowerCaseDesc.includes('lanchonete') || lowerCaseDesc.includes('comida')) return 'Alimentação';
  if (lowerCaseDesc.includes('transporte') || lowerCaseDesc.includes('combustível') || lowerCaseDesc.includes('uber') || lowerCaseDesc.includes('ônibus')) return 'Transporte';
  if (lowerCaseDesc.includes('lazer') || lowerCaseDesc.includes('cinema') || lowerCaseDesc.includes('viagem')) return 'Lazer';
  if (lowerCaseDesc.includes('saude') || lowerCaseDesc.includes('farmacia') || lowerCaseDesc.includes('medico') || lowerCaseDesc.includes('saúde') || lowerCaseDesc.includes('médico')) return 'Saúde';
  if (lowerCaseDesc.includes('moradia') || lowerCaseDesc.includes('aluguel') || lowerCaseDesc.includes('condominio') || lowerCaseDesc.includes('condomínio')) return 'Moradia';
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
    console.log('MongoDB conectado com sucesso');
    return connection;
  } catch (error) {
    console.error('Erro ao conectar com MongoDB:', error);
    throw error;
  }
};

// Send WhatsApp message function
const sendWhatsAppMessage = async (to: string, message: string, phoneNumberId: string) => {
  if (!API_TOKEN) {
    console.error('WhatsApp API token não configurado');
    return false;
  }

  try {
    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
    
    console.log('Enviando mensagem:', {
      to,
      message: message.substring(0, 50) + '...',
      url
    });

    const response = await axios.post(url, {
      messaging_product: 'whatsapp',
      to: to,
      text: { body: message },
    }, {
      headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('Mensagem enviada com sucesso:', response.data);
    return true;
  } catch (error) {
    console.error('Erro ao enviar mensagem WhatsApp:', error);
    if (axios.isAxiosError(error)) {
      console.error('Response data:', error.response?.data);
      console.error('Response status:', error.response?.status);
    }
    return false;
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log(`${new Date().toISOString()} - ${req.method} request to ${req.url}`);
  
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      // Webhook verification
      const { 
        'hub.mode': mode, 
        'hub.verify_token': token, 
        'hub.challenge': challenge 
      } = req.query;

      console.log('Webhook verification attempt:', { 
        mode, 
        token: token ? 'present' : 'missing',
        tokenMatch: token === VERIFY_TOKEN,
        challenge: challenge ? 'present' : 'missing'
      });

      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Webhook verified successfully!');
        return res.status(200).send(challenge as string);
      } else {
        console.log('❌ Webhook verification failed - token mismatch or invalid mode');
        return res.status(403).send('Forbidden');
      }
    }

    if (req.method === 'POST') {
      await connectToDatabase();
      
      const data = req.body;
      console.log('Received webhook data:', JSON.stringify(data, null, 2));

      if (!data || data.object !== 'whatsapp_business_account') {
        console.log('❌ Invalid webhook data - not whatsapp_business_account');
        return res.status(400).json({ error: 'Invalid data' });
      }

      // Process messages
      for (const entry of data.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value;
          
          if (!value) {
            console.log('No value in change, skipping');
            continue;
          }

          const phoneNumberId = value.metadata?.phone_number_id;
          
          if (!phoneNumberId) {
            console.log('❌ Phone number ID not found in metadata');
            continue;
          }

          if (value.messages) {
            for (const message of value.messages) {
              const incomingMessage = message.text?.body;
              const waId = message.from;

              console.log('Processing message:', {
                from: waId,
                message: incomingMessage,
                messageId: message.id,
                timestamp: message.timestamp
              });

              if (!incomingMessage || !waId) {
                console.log('❌ Message or sender ID missing');
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
                console.log('✅ New user mapping created:', { waId, userId });
              } else {
                userId = userMapping.dashboardUserId;
                console.log('✅ Existing user found:', { waId, userId });
              }

              // Process commands
              if (lowerCaseMessage === 'ajuda' || lowerCaseMessage === 'comandos' || lowerCaseMessage === 'help') {
                const replyMessage = "🤖 *Comandos disponíveis:*\n\n" +
                  "💰 *Registrar despesa:* '50 no mercado'\n" +
                  "💵 *Registrar receita:* 'recebi 1000 salário'\n" +
                  "📊 *Relatório:* 'relatório' ou 'saldo'\n" +
                  "🗑️ *Apagar transação:* 'apagar [ID]'\n" +
                  "ℹ️ *Ajuda:* 'ajuda' ou 'comandos'\n\n" +
                  "📱 Seu ID de usuário: `" + userId + "`";
                
                const sent = await sendWhatsAppMessage(waId, replyMessage, phoneNumberId);
                console.log('Help message sent:', sent);
                continue;
              }

              // Relatório command
              if (lowerCaseMessage === 'relatório' || lowerCaseMessage === 'relatorio' || lowerCaseMessage === 'saldo') {
                const transactions = await Transaction.find({ userId }).sort({ createdAt: -1 }).limit(10);
                
                const totalIncome = transactions
                  .filter(t => t.type === 'income')
                  .reduce((sum, t) => sum + t.amount, 0);

                const totalExpenses = transactions
                  .filter(t => t.type === 'expense')
                  .reduce((sum, t) => sum + t.amount, 0);

                const balance = totalIncome - totalExpenses;

                let replyMessage = `📊 *Relatório Financeiro*\n\n`;
                replyMessage += `💰 Receitas: R$ ${totalIncome.toFixed(2)}\n`;
                replyMessage += `💸 Despesas: R$ ${totalExpenses.toFixed(2)}\n`;
                replyMessage += `💼 Saldo: R$ ${balance.toFixed(2)}\n\n`;
                
                if (transactions.length > 0) {
                  replyMessage += `📝 *Últimas transações:*\n`;
                  transactions.slice(0, 5).forEach((t, index) => {
                    const emoji = t.type === 'income' ? '💰' : '💸';
                    replyMessage += `${emoji} R$ ${t.amount.toFixed(2)} - ${t.description}\n`;
                  });
                } else {
                  replyMessage += `ℹ️ Nenhuma transação encontrada.`;
                }

                const sent = await sendWhatsAppMessage(waId, replyMessage, phoneNumberId);
                console.log('Report message sent:', sent);
                continue;
              }

              // Delete transaction command
              if (lowerCaseMessage.startsWith('apagar ')) {
                const transactionId = lowerCaseMessage.replace('apagar ', '').trim();
                
                try {
                  const deletedTransaction = await Transaction.findOneAndDelete({
                    _id: transactionId,
                    userId: userId
                  });

                  if (deletedTransaction) {
                    const replyMessage = `✅ *Transação apagada com sucesso!*\n\n` +
                      `💸 R$ ${deletedTransaction.amount.toFixed(2)} - ${deletedTransaction.description}`;
                    
                    const sent = await sendWhatsAppMessage(waId, replyMessage, phoneNumberId);
                    console.log('Delete confirmation sent:', sent);
                  } else {
                    const replyMessage = `❌ Transação não encontrada ou não pertence a você.`;
                    const sent = await sendWhatsAppMessage(waId, replyMessage, phoneNumberId);
                    console.log('Delete error sent:', sent);
                  }
                } catch (error) {
                  console.error('Error deleting transaction:', error);
                  const replyMessage = `❌ Erro ao apagar transação. Verifique o ID.`;
                  const sent = await sendWhatsAppMessage(waId, replyMessage, phoneNumberId);
                  console.log('Delete error sent:', sent);
                }
                continue;
              }

              // Process transaction
              const generalRegex = /(\d+[\.,]?\d*)\s*(.*)/i;
              const incomeKeywords = ['recebi', 'receita', 'ganho', 'salário', 'salario', 'pagamento'];
              const match = incomingMessage.match(generalRegex);

              if (match) {
                const amount = parseFloat(match[1].replace(',', '.'));
                const description = match[2]?.trim() || 'Transação sem descrição';
                const type = incomeKeywords.some(keyword => lowerCaseMessage.includes(keyword)) ? 'income' : 'expense';
                const category = getCategoryFromDescription(description);

                console.log('Creating transaction:', { userId, type, amount, description, category });

                const newTransaction = new Transaction({ userId, type, amount, description, category });
                await newTransaction.save();

                const emoji = type === 'expense' ? '💸' : '💰';
                const typeText = type === 'expense' ? 'Despesa' : 'Receita';
                
                const confirmationMessage = `✅ *${typeText} registrada!*\n\n` +
                  `${emoji} *Valor:* R$ ${amount.toFixed(2)}\n` +
                  `📝 *Descrição:* ${description}\n` +
                  `🏷️ *Categoria:* ${category}\n` +
                  `🆔 *ID:* \`${newTransaction._id}\`\n\n` +
                  `💡 Digite 'relatório' para ver seu saldo atual.`;

                const sent = await sendWhatsAppMessage(waId, confirmationMessage, phoneNumberId);
                console.log('Transaction confirmation sent:', sent);
              } else {
                const replyMessage = `❓ *Não entendi sua mensagem.*\n\n` +
                  `📝 Exemplos:\n` +
                  `• "50 no mercado" (despesa)\n` +
                  `• "recebi 1000 salário" (receita)\n\n` +
                  `💡 Digite 'ajuda' para ver todos os comandos.`;

                const sent = await sendWhatsAppMessage(waId, replyMessage, phoneNumberId);
                console.log('Help suggestion sent:', sent);
              }
            }
          }

          // Handle message status updates (read receipts, delivery, etc.)
          if (value.statuses) {
            console.log('Message status update:', value.statuses);
          }
        }
      }

      return res.status(200).json({ status: 'success', timestamp: new Date().toISOString() });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });

  } catch (error) {
    console.error('❌ Webhook error:', error);
    return res.status(500).json({ 
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
}