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
  const from = req.body.From;
  const userId = req.body.WaId;

  try {
    if (!incomingMessage || !userId) {
        return res.status(400).send('Mensagem ou UserID inválido.');
    }

    const lowerCaseMessage = incomingMessage.toLowerCase().trim();
    
    // --- Lógica para comando "Ajuda" (movida para o início) ---
    if (lowerCaseMessage === 'ajuda' || lowerCaseMessage === 'comandos') {
      const replyMessage = "Comandos disponíveis:\n\n" +
        "• Registrar despesa: '50 no mercado'\n" +
        "• Registrar receita: 'recebi 1000 salário'\n" +
        "• Relatório: 'relatório de hoje' ou 'relatório do mês'\n" +
        "• Ver dashboard: 'dashboard'\n" +
        "• Apagar transação: 'apagar [ID da transação]'";

      await twilioClient.messages.create({
        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
        to: from,
        body: replyMessage
      });
      return res.status(200).send('Webhook received - help command processed');
    }

    // ... (restante do código para Relatório, Apagar, etc.)

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
        userId,
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
      
      await twilioClient.messages.create({
        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
        to: from,
        body: replyMessage
      });
      return res.status(200).send('Webhook received - command processed');
    }
    
    // --- Lógica para comando "Apagar" ---
    const deleteRegex = /(apagar|remover|excluir)\s*(\S+)/i;
    const deleteMatch = lowerCaseMessage.match(deleteRegex);

    if (deleteMatch) {
      const transactionId = deleteMatch[2];
      const transaction = await Transaction.findOneAndDelete({
        _id: transactionId,
        $or: [
          { userId },
          { userId: { $exists: false } }
        ]
      });

      if (transaction) {
        replyMessage = `Transação "${transaction.description}" (ID: ${transaction._id}) foi excluída com sucesso.`;
      } else {
        replyMessage = `Não foi possível encontrar a transação com ID "${transactionId}" ou você não tem permissão para excluí-la.`;
      }

      await twilioClient.messages.create({
        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
        to: from,
        body: replyMessage
      });
      return res.status(200).send('Webhook received - command processed');
    }

    // --- Lógica para comando "Dashboard" ---
    if (lowerCaseMessage.includes('dashboard') || lowerCaseMessage.includes('link')) {
        const frontendUrl = process.env.FRONTEND_URL;
        replyMessage = `Aqui está o link do seu dashboard financeiro: ${frontendUrl}?userId=${userId}`;

        await twilioClient.messages.create({
          from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
          to: from,
          body: replyMessage
        });
        return res.status(200).send('Webhook received - command processed');
    }

    // --- Lógica de Criação de Transação ---
    const generalRegex = /(\d+[\.,]?\d*)\s*(.*)/i;
    const incomeKeywords = ['recebi', 'receita', 'ganho', 'salário'];

    let type: 'income' | 'expense' | null = null;
    let amount: number | null = null;
    let description: string | null = null;
    let match = incomingMessage.match(generalRegex);

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
      
      await twilioClient.messages.create({
        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
        to: from,
        body: confirmationMessage
      });
      return res.status(200).send('Webhook received - transaction saved');
    } else {
      await twilioClient.messages.create({
        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
        to: from,
        body: "Não entendi sua solicitação. Envie 'ajuda' para ver a lista de comandos."
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
