import { Router, Request, Response } from 'express';
import { Transaction } from '../models/Transaction';
import { getCategoryFromDescription } from '../utils/categoryUtils';

const router = Router();

// Rota para criar uma nova transação
router.post('/transactions', async (req: Request, res: Response) => {
  const { type, amount, description } = req.body;
  try {
    if (!type || !amount || !description) {
      return res.status(400).json({ message: 'Dados inválidos.' });
    }

    const category = getCategoryFromDescription(description);

    const newTransaction = new Transaction({ type, amount, description, category });
    await newTransaction.save();
    res.status(201).json(newTransaction);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao salvar a transação.', error });
  }
});

// Rota para buscar todas as transações
router.get('/transactions', async (req: Request, res: Response) => {
  try {
    const transactions = await Transaction.find().sort({ createdAt: -1 });

    const totalIncome = transactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalExpenses = transactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);

    const balance = totalIncome - totalExpenses;

    const categorySummary: Record<string, number> = {};
    transactions
      .filter(t => t.type === 'expense')
      .forEach(t => {
        categorySummary[t.category] = (categorySummary[t.category] || 0) + t.amount;
      });

    const summary = {
      totalIncome,
      totalExpenses,
      balance,
      categorySummary,
      transactionCount: transactions.length,
    };

    res.status(200).json({ transactions, summary });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar as transações.', error });
  }
});

export default router;