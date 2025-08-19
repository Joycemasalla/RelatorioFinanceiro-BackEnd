import { Router, Request, Response } from 'express';
import { Twilio } from 'twilio';
import { Transaction, ITransaction } from './models/Transaction';
import { getCategoryFromDescription } from './utils/categoryUtils';
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();
const twilioClient = new Twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

router.post('/twilio-webhook', async (req: Request, res: Response) => {
  console.log('--- Webhook recebido ---');
  console.log('Corpo da requisição:', req.body);

  const incomingMessage = req.body.Body;
  const from = req.body.From;

  try {
    if (!incomingMessage) {
        console.log('Mensagem de entrada vazia. Ignorando.');
        return res.status(400).send('Mensagem de entrada vazia.');
    }

    const lowerCaseMessage = incomingMessage.toLowerCase().trim();
    console.log('Mensagem processada:', lowerCaseMessage);
    
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
      console.log('Requisitado um relatório. Buscando transações de', startDate, 'a', endDate);
      const transactions = await Transaction.find({
        createdAt: {
          $gte: startDate,
          $lte: endDate
        },
        type: 'expense'
      });
      console.log(`Encontradas ${transactions.length} transações.`);

      const totalExpenses = transactions.reduce((sum: number, t: ITransaction) => sum + t.amount, 0);

      const expensesByCategory: { [key: string]: number } = {};
      transactions.forEach((t: ITransaction) => {
        expensesByCategory[t.category] = (expensesByCategory[t.category] || 0) + t.amount;
      });

      let reportMessage = `${reportTitle}\n\n`;
      reportMessage += `Gasto total: R$ ${totalExpenses.toFixed(2)}\n\n`;
      
      if (transactions.length > 0) {
          for (const category in expensesByCategory) {
            reportMessage += `- ${category}: R$ ${expensesByCategory[category].toFixed(2)}\n`;
          }
      } else {
          reportMessage += 'Nenhum gasto encontrado neste período.';
      }
      
      console.log('Mensagem de relatório a ser enviada:', reportMessage);
      
      await twilioClient.messages.create({
        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
        to: from,
        body: reportMessage
      });
      return res.status(200).send('Webhook received - report sent');
    }

    // Lógica Existente para Adicionar Transação
    const expenseRegex = /(gastei|despesa|gasto)[\s\S]*?(\d+[\.,]?\d*)\s*(.*)/i;
    const incomeRegex = /(recebi|receita|ganho)[\s\S]*?(\d+[\.,]?\d*)\s*(.*)/i;

    let type: 'income' | 'expense' | null = null;
    let amount: number | null = null;
    let description: string | null = null;
    let match = incomingMessage.match(expenseRegex);

    if (match) {
      type = 'expense';
      amount = parseFloat(match[2].replace(',', '.'));
      description = match[3].trim();
      console.log(`Mensagem corresponde a um gasto: Tipo=${type}, Valor=${amount}, Descrição=${description}`);
    } else {
      match = incomingMessage.match(incomeRegex);
      if (match) {
        type = 'income';
        amount = parseFloat(match[2].replace(',', '.'));
        description = match[3].trim();
        console.log(`Mensagem corresponde a uma receita: Tipo=${type}, Valor=${amount}, Descrição=${description}`);
      }
    }

    if (type && amount !== null && description) {
      const category = getCategoryFromDescription(description);
      console.log('Transação categorizada como:', category);
      const newTransaction = new Transaction({ type, amount, description, category });
      await newTransaction.save();
      
      console.log('Transação salva com sucesso no banco de dados.');
      await twilioClient.messages.create({
        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
        to: from,
        body: `Transação de ${type === 'expense' ? 'gasto' : 'receita'} de R$ ${amount.toFixed(2)} (${category}) registrada com sucesso!`
      });
      return res.status(200).send('Webhook received - transaction saved');
    } else {
      console.log('Mensagem não reconhecida. Enviando mensagem de erro...');
      await twilioClient.messages.create({
        from: `whatsapp:${process.env.TWILIO_PHONE_NUMBER}`,
        to: from,
        body: "Não entendi a transação. Tente 'gastei 50 no mercado' ou 'recebi 1000 de salário'. Para um relatório, use 'relatório de hoje', 'relatório do mês' ou 'relatório da semana'."
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