import { Router, Request, Response } from 'express';
import { Transaction, ITransaction } from './models/Transaction';
import { UserMapping, IUserMapping } from './models/UserMapping';
import { getCategoryFromDescription } from './utils/categoryUtils';
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import dotenv from 'dotenv';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const router = Router();
const API_TOKEN = process.env.WHATSAPP_API_TOKEN;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;



// Rota para verificação do webhook
router.get('/whatsapp-webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verificado!');
      res.status(200).send(challenge);
    } else {
      res.status(403).send('Webhook de verificação falhou.');
    }
  } else {
    res.status(400).send('Dados de verificação inválidos.');
  }
});

// Rota para receber mensagens do WhatsApp
router.post('/whatsapp-webhook', async (req: Request, res: Response) => {
  const data = req.body;
  
  if (data.object === 'whatsapp_business_account') {
    try {
      for (const entry of data.entry) {
        for (const change of entry.changes) {
          if (change.value.messages) {
            for (const message of change.value.messages) {
              const incomingMessage = message.text.body;
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

              // --- Funções para enviar a resposta ---
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
              
              // --- Lógica de Comandos (a mesma que já está funcionando) ---
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
              
              // ... (O restante da sua lógica para 'Relatório', 'Apagar', etc.
              // deve ser copiada e colada aqui, substituindo twilioClient.messages.create
              // por `await sendMessage(replyMessage)`
              // Lógica de Criação de Transação - ajuste o trecho final
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
});

export default router;