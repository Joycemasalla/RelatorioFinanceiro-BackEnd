import { Schema, model, Document } from 'mongoose';

export interface ITransaction extends Document {
  userId?: string;
  type: 'income' | 'expense';
  amount: number;
  description: string;
  category: string;
  createdAt: Date;
}

const transactionSchema = new Schema<ITransaction>({
  userId: { type: String }, // 'required: true' foi removido
  type: { type: String, required: true, enum: ['income', 'expense'] },
  amount: { type: Number, required: true },
  description: { type: String, required: true },
  category: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

export const Transaction = model<ITransaction>('Transaction', transactionSchema);