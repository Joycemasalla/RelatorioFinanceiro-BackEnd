import { Router, Request, Response } from 'express';
import { Twilio } from 'twilio';
import { Transaction, ITransaction } from './models/Transaction';
import { getCategoryFromDescription } from './utils/categoryUtils';
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const router = Router();
const twilioClient = new Twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

router.post('/twilio-webhook', async (req: Request, res: Response) => {
  const incomingMessage = req.body.Body;
  const from = req.body.From; // Ex: whatsapp:+553288949994
  const userId = req.body.WaId; // O ID único do usuário no WhatsApp

  console.log('--- Webhook recebido ---');
  console.log('Mensagem de:', from, ' | Corpo:', incomingMessage, ' | UserID:', userId);

  try {
    if (!incomingMessage || !userId) {
        console.log('Mensagem ou UserID inválido. Ignorando.');
        return res.status(400).send('Mensagem ou UserID inválido.');
    }

    const lowerCaseMessage = incomingMessage.toLowerCase().trim();
    
    let replyMessage = '';

    // --- Lógica para comando "Relatório" ---
    let startDate: Date | null = null;
    let endDate: Date | null = null;
    let reportTitle = '';
    
    if (lowerCaseMessage.includes('relatório do mês') || lowerCaseMessage.includes('gastos do mês')) {
      startDate = startOfMonth(new Date());
      endDate = endOfMonth(new Date());
      reportTitle = `Relatório do Mês de ${format(new Date(), 'MMMM', { locale: ptBR })}`;
    } else if (lowerCaseMessage.includes('relatório de hoje') || lowerCaseMessage.includes('gastos de hoje')) {
      startDate = startOfDay(new Date());
      endDate = endOfDay(new Date());
      reportTitle = `Relatório de Hoje, ${format(new Date(), 'dd/MM/yyyy')}`;
    } else if (lowerCaseMessage.includes('relatório da semana') || lowerCaseMessage.includes('gastos da semana')) {
      startDate = new Date(new Date().setDate(new Date().getDate() - 7));
      endDate = new Date();
      reportTitle = `Relatório dos Últimos 7 Dias`;
    } else if (lowerCaseMessage.includes('relatório')) {
      startDate = startOfDay(new Date());
      endDate = endOfDay(new Date());
      reportTitle = `Relatório de Hoje, ${format(new Date(), 'dd/MM/yyyy')}`;
    }

    if (startDate && endDate) {
      const transactions = await Transaction.find({
        userId, // Filtra por usuário
        createdAt: {
          $gte: startDate,
          $lte: endDate
        },
        type: 'expense'
      });

      const totalExpenses = transactions.reduce((sum: number, t: ITransaction) => sum + t.amount, 0);

      const expensesByCategory: { [key: string]: number } = {};
      transactions.forEach((t: ITransaction) => {
        expensesByCategory[t.category] = (expensesByCategory[t.category] || 0) + t.amount;
      });

      replyMessage += `${reportTitle}\n\n`;
      replyMessage += `Gasto total: R$ ${totalExpenses.toFixed(2)}\n\n`;
      
      if (transactions.length > 0) {
          replyMessage += 'Distribuição por Categoria:\n';
          for (const category in expensesByCategory) {
            replyMessage += `- ${category}: R$ ${expensesByCategory[category].toFixed(2)}\n`;
          }
      } else {
          replyMessage += 'Nenhum gasto encontrado neste período.';
      }
    }
    
    // --- Nova Lógica para comando "Apagar" ---
    const deleteRegex = /(apagar|remover|excluir)\s*(\S+)/i;
    const deleteMatch = lowerCaseMessage.match(deleteRegex);

    if (deleteMatch) {
      const transactionId = deleteMatch[2];
      const transaction = await Transaction.findOneAndDelete({ _id: transactionId, userId });

      if (transaction) {
        replyMessage = `Transação "${transaction.description}" (ID: ${transaction._id}) foi excluída com sucesso.`;
      } else {
        replyMessage = `Não foi possível encontrar a transação com ID "${transactionId}" ou você não tem permissão para excluí-la.`;
      }
    }

    // --- Nova Lógica para comando "Dashboard" ---
    if (lowerCaseMessage.includes('dashboard') || lowerCaseMessage.includes('link')) {
        const frontendUrl = process.env.FRONTEND_URL;
        replyMessage = `Aqui está o link do seu dashboard financeiro: ${frontendUrl}?userId=${userId}`;
    }

    if (replyMessage) {
        await twilioClient.messages.create({
          from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
          to: from,
          body: replyMessage
        });
        return res.status(200).send('Webhook received - command processed');
    }

    // --- Lógica de Criação de Transação ---
    const expenseRegex = /(gastei|despesa|gasto)\s*(\d+[\.,]?\d*)\s*(.*)/i;
    const incomeRegex = /(recebi|receita|ganho)\s*(\d+[\.,]?\d*)\s*(.*)/i;

    let type: 'income' | 'expense' | null = null;
    let amount: number | null = null;
    let description: string | null = null;
    let match = incomingMessage.match(expenseRegex);

    if (match) {
      type = 'expense';
      amount = parseFloat(match[2].replace(',', '.'));
      description = match[3].trim();
    } else {
      match = incomingMessage.match(incomeRegex);
      if (match) {
        type = 'income';
        amount = parseFloat(match[2].replace(',', '.'));
        description = match[3].trim();
      }
    }

    if (type && amount !== null && description) {
      const category = getCategoryFromDescription(description);
      const newTransaction = new Transaction({ userId, type, amount, description, category });
      await newTransaction.save();
      
      console.log('Transação salva via WhatsApp:', newTransaction);
      const confirmationMessage = `Transação salva com sucesso!\nDetalhes:\n- Tipo: ${type === 'expense' ? 'Gasto' : 'Receita'}\n- Valor: R$ ${amount.toFixed(2)}\n- Descrição: ${description}\n- Categoria: ${category}\n- ID: ${newTransaction._id}`;
      
      await twilioClient.messages.create({
        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
        to: from,
        body: confirmationMessage
      });
      return res.status(200).send('Webhook received - transaction saved');
    } else {
      console.log('Mensagem não reconhecida. Enviando mensagem de erro...');
      await twilioClient.messages.create({
        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
        to: from,
        body: "Não entendi sua solicitação. Use 'gastei 50 no mercado', 'recebi 1000 salário', 'relatório do mês', 'dashboard' ou 'apagar [ID da transação]'."
      });
      return res.status(400).send('Invalid message format');
    }
  } catch (error) {
    console.error('Erro ao processar webhook do Twilio:', error);
    await twilioClient.messages.create({
      from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
      to: from,
      body: 'Ocorreu um erro ao processar sua solicitação.'
    });
    return res.status(500).send('Server error');
  }
});

export default router;