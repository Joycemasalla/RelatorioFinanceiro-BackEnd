import { Router, Request, Response } from 'express';
import { Transaction, ITransaction } from '../models/Transaction';
import { getCategoryFromDescription } from '../utils/categoryUtils';

const router = Router();

// Rota para criar uma nova transação
router.post('/transactions', async (req: Request, res: Response) => {
  const { userId, type, amount, description } = req.body;
  try {
    if (!userId || !type || !amount || !description) {
      return res.status(400).json({ message: 'Dados inválidos.' });
    }

    const category = getCategoryFromDescription(description);

    const newTransaction = new Transaction({ userId, type, amount, description, category });
    await newTransaction.save();
    res.status(201).json(newTransaction);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao salvar a transação.', error });
  }
});

// Rota para buscar todas as transações de um usuário específico
router.get('/transactions/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;
  try {
    const transactions = await Transaction.find({
        $or: [
            { userId },
            { userId: { $exists: false } }
        ]
    }).sort({ createdAt: -1 });

    const totalIncome = transactions
      .filter((t: ITransaction) => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalExpenses = transactions
      .filter((t: ITransaction) => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);

    const balance = totalIncome - totalExpenses;

    const categorySummary: Record<string, number> = {};
    transactions
      .filter((t: ITransaction) => t.type === 'expense')
      .forEach((t: ITransaction) => {
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

// NOVA ROTA: Rota para excluir uma transação específica de um usuário
router.delete('/transactions/:userId/:id', async (req: Request, res: Response) => {
  const { userId, id } = req.params;
  try {
    const transaction = await Transaction.findOneAndDelete({ _id: id, userId });
    
    if (!transaction) {
      return res.status(404).json({ message: 'Transação não encontrada ou não pertence a este usuário.' });
    }

    res.status(200).json({ message: 'Transação excluída com sucesso.', transaction });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao excluir a transação.', error });
  }
});


export default router;