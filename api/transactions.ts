import mongoose, { Schema, Document } from 'mongoose';
import { VercelRequest, VercelResponse } from '@vercel/node';

const MONGO_URI = process.env.MONGO_URI;

// Interfaces
interface ITransaction extends Document {
  userId?: string;
  type: 'income' | 'expense';
  amount: number;
  description: string;
  category: string;
  createdAt: Date;
}

// Schema
const transactionSchema = new Schema<ITransaction>({
  userId: { type: String },
  type: { type: String, required: true, enum: ['income', 'expense'] },
  amount: { type: Number, required: true },
  description: { type: String, required: true },
  category: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

// Model
const Transaction = mongoose.models.Transaction || mongoose.model<ITransaction>('Transaction', transactionSchema);

// Utilitário para categorização
const getCategoryFromDescription = (description: string): string => {
  const desc = description.toLowerCase();
  
  if (desc.includes('mercado') || desc.includes('supermercado') || desc.includes('padaria') || desc.includes('restaurante')) {
    return 'Alimentação';
  }
  if (desc.includes('combustível') || desc.includes('uber') || desc.includes('transporte') || desc.includes('ônibus')) {
    return 'Transporte';
  }
  if (desc.includes('remédio') || desc.includes('farmácia') || desc.includes('médico') || desc.includes('hospital')) {
    return 'Saúde';
  }
  if (desc.includes('salário') || desc.includes('freelance') || desc.includes('pagamento')) {
    return 'Trabalho';
  }
  if (desc.includes('aluguel') || desc.includes('luz') || desc.includes('água') || desc.includes('internet')) {
    return 'Contas';
  }
  
  return 'Outros';
};

// Conexão com MongoDB
let cachedConnection: typeof mongoose | null = null;

const connectToDatabase = async () => {
  if (cachedConnection) {
    return cachedConnection;
  }

  if (!MONGO_URI) {
    throw new Error('MONGO_URI não definida');
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
  try {
    await connectToDatabase();

    if (req.method === 'POST') {
      // Criar transação
      const { userId, type, amount, description } = req.body;
      
      if (!type || !amount || !description) {
        return res.status(400).json({ message: 'Dados inválidos.' });
      }

      const category = getCategoryFromDescription(description);
      const newTransaction = new Transaction({ userId, type, amount, description, category });
      await newTransaction.save();
      
      return res.status(201).json(newTransaction);
    }

    if (req.method === 'GET') {
      // Buscar transações
      let { userId } = req.query;
      
      // Se não tem userId, busca todas as transações (para compatibilidade)
      const query = userId 
        ? {
            $or: [
              { userId },
              { userId: { $exists: false } }
            ]
          }
        : {};

      const transactions = await Transaction.find(query).sort({ createdAt: -1 });

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

      return res.status(200).json({ transactions, summary });
    }

    if (req.method === 'DELETE') {
      // Excluir transação
      const { userId, id } = req.query;
      
      if (!userId || !id) {
        return res.status(400).json({ message: 'userId e id são obrigatórios' });
      }

      const transaction = await Transaction.findOneAndDelete({
        _id: id as string,
        $or: [
          { userId },
          { userId: { $exists: false } }
        ]
      });
      
      if (!transaction) {
        return res.status(404).json({ message: 'Transação não encontrada.' });
      }

      return res.status(200).json({ message: 'Transação excluída com sucesso.', transaction });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });

  } catch (error) {
    console.error('Erro na API de transações:', error);
    return res.status(500).json({ message: 'Erro interno do servidor', error });
  }
}