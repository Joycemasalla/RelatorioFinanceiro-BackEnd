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

console.log('🔑 Configurações do Webhook:');
console.log('API_TOKEN:', API_TOKEN ? 'Configurado' : '❌ Não configurado');
console.log('VERIFY_TOKEN:', VERIFY_TOKEN ? 'Configurado' : '❌ Não configurado');

// Rota para verificação do webhook
router.get('/', (req: Request, res: Response) => {
  console.log('📥 Requisição de verificação recebida:', req.query);
  
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('🔍 Dados de verificação:');
  console.log('Mode:', mode);
  console.log('Token recebido:', token);
  console.log('Token esperado:', VERIFY_TOKEN);
  console.log('Challenge:', challenge);
  console.log('Tokens são iguais?', token === VERIFY_TOKEN);

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook verificado com sucesso!');
      res.status(200).send(challenge);
    } else {
      console.log('❌ Falha na verificação do webhook - token incorreto');
      res.status(403).send('Forbidden - Token incorreto');
    }
  } else {
    console.log('❌ Dados de verificação inválidos');
    res.status(400).send('Bad Request - Dados inválidos');
  }
});

// Rota para receber mensagens do WhatsApp
router.post('/', async (req: Request, res: Response) => {
  console.log('📨 Mensagem recebida:', JSON.stringify(req.body, null, 2));
  
  const data = req.body;

  if (data.object === 'whatsapp_business_account') {
    try {
      for (const entry of data.entry) {
        for (const change of entry.changes) {
          if (change.value.messages) {
            for (const message of change.value.messages) {
              const incomingMessage = message.text?.body;
              const waId = message.from;

              console.log('📱 Processando mensagem:', { waId, message: incomingMessage });

              if (!incomingMessage || !waId) {
                console.log('❌ Mensagem ou WaId inválido');
                continue;
              }

              const lowerCaseMessage = incomingMessage.toLowerCase().trim();

              let userMapping = await UserMapping.findOne({ waId });
              let userId;

              if (!userMapping) {
                const newDashboardUserId = uuidv4();
                userMapping = new UserMapping({ waId, dashboardUserId: newDashboardUserId });
                await userMapping.save();
                userId = newDashboardUserId;
                console.log('👤 Novo usuário criado:', userId);
              } else {
                userId = userMapping.dashboardUserId;
                console.log('👤 Usuário existente:', userId);
              }

              // Função para enviar mensagem
              const sendMessage = async (body: string) => {
                try {
                  const url = `https://graph.facebook.com/v20.0/${change.value.metadata.phone_number_id}/messages`;
                  const response = await axios.post(url, {
                    messaging_product: 'whatsapp',
                    to: waId,
                    text: { body },
                  }, {
                    headers: {
                      'Authorization': `Bearer ${API_TOKEN}`,
                      'Content-Type': 'application/json',
                    },
                  });
                  console.log('✅ Mensagem enviada com sucesso');
                } catch (error) {
                  console.error('❌ Erro ao enviar mensagem:', error);
                }
              };

              // Comando de ajuda
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

              // Comando de dashboard
              if (lowerCaseMessage === 'dashboard') {
                const dashboardUrl = `https://relatorio-financeiro-front-end.vercel.app?userId=${userId}`;
                await sendMessage(`🔗 Acesse seu dashboard financeiro:\n${dashboardUrl}`);
                continue;
              }

              // Lógica de relatório
              if (lowerCaseMessage.includes('relatório') || lowerCaseMessage.includes('relatorio')) {
                try {
                  let startDate, endDate, periodText;

                  if (lowerCaseMessage.includes('hoje')) {
                    startDate = startOfDay(new Date());
                    endDate = endOfDay(new Date());
                    periodText = 'hoje';
                  } else if (lowerCaseMessage.includes('mês') || lowerCaseMessage.includes('mes')) {
                    startDate = startOfMonth(new Date());
                    endDate = endOfMonth(new Date());
                    periodText = 'este mês';
                  } else {
                    startDate = startOfMonth(new Date());
                    endDate = endOfMonth(new Date());
                    periodText = 'este mês';
                  }

                  const transactions = await Transaction.find({
                    userId,
                    createdAt: { $gte: startDate, $lte: endDate }
                  }).sort({ createdAt: -1 });

                  const totalIncome = transactions
                    .filter(t => t.type === 'income')
                    .reduce((sum, t) => sum + t.amount, 0);

                  const totalExpenses = transactions
                    .filter(t => t.type === 'expense')
                    .reduce((sum, t) => sum + t.amount, 0);

                  const balance = totalIncome - totalExpenses;

                  let reportMessage = `📊 *Relatório de ${periodText}*\n\n`;
                  reportMessage += `💰 Receitas: R$ ${totalIncome.toFixed(2)}\n`;
                  reportMessage += `💸 Despesas: R$ ${totalExpenses.toFixed(2)}\n`;
                  reportMessage += `💳 Saldo: R$ ${balance.toFixed(2)}\n\n`;

                  if (transactions.length > 0) {
                    reportMessage += `📋 Últimas transações:\n`;
                    transactions.slice(0, 5).forEach(t => {
                      const icon = t.type === 'income' ? '💚' : '💸';
                      reportMessage += `${icon} R$ ${t.amount.toFixed(2)} - ${t.description}\n`;
                    });
                  } else {
                    reportMessage += 'Nenhuma transação encontrada para este período.';
                  }

                  await sendMessage(reportMessage);
                  continue;
                } catch (error) {
                  console.error('Erro ao gerar relatório:', error);
                  await sendMessage('Erro ao gerar relatório. Tente novamente.');
                  continue;
                }
              }

              // Lógica para apagar transação
              if (lowerCaseMessage.startsWith('apagar ')) {
                const transactionId = lowerCaseMessage.replace('apagar ', '').trim();
                try {
                  const deletedTransaction = await Transaction.findOneAndDelete({
                    _id: transactionId,
                    userId
                  });

                  if (deletedTransaction) {
                    await sendMessage(`✅ Transação apagada com sucesso!\nR$ ${deletedTransaction.amount.toFixed(2)} - ${deletedTransaction.description}`);
                  } else {
                    await sendMessage('❌ Transação não encontrada. Verifique o ID.');
                  }
                  continue;
                } catch (error) {
                  console.error('Erro ao apagar transação:', error);
                  await sendMessage('Erro ao apagar transação. Verifique o ID e tente novamente.');
                  continue;
                }
              }

              // Lógica de criação de transação
              const generalRegex = /(\d+[\.,]?\d*)\s*(.*)/i;
              const incomeKeywords = ['recebi', 'receita', 'ganho', 'salário'];
              const match = incomingMessage.match(generalRegex);

              if (match) {
                try {
                  const amount = parseFloat(match[1].replace(',', '.'));
                  const description = match[2]?.trim() || 'Transação';
                  const type = incomeKeywords.some(keyword => lowerCaseMessage.includes(keyword)) ? 'income' : 'expense';
                  const category = getCategoryFromDescription(description);

                  const newTransaction = new Transaction({ userId, type, amount, description, category });
                  await newTransaction.save();

                  const confirmationMessage = `✅ Transação salva com sucesso!\nDetalhes:\n- Tipo: ${type === 'expense' ? 'Gasto' : 'Receita'}\n- Valor: R$ ${amount.toFixed(2)}\n- Descrição: ${description}\n- Categoria: ${category}\n- ID: ${newTransaction._id}`;

                  await sendMessage(confirmationMessage);
                } catch (error) {
                  console.error('Erro ao salvar transação:', error);
                  await sendMessage('Erro ao salvar transação. Tente novamente.');
                }
              } else {
                await sendMessage("❓ Não entendi sua solicitação. Envie 'ajuda' para ver a lista de comandos.");
              }
            }
          }
        }
      }

      res.status(200).json({ status: 'success' });
    } catch (error) {
      console.error('❌ Erro ao processar webhook do WhatsApp:', error);
      res.status(500).send('Server error');
    }
  } else {
    res.status(400).json({ error: 'Invalid request' });
  }
});

export default router;