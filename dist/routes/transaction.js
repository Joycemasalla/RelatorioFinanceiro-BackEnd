"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const Transaction_1 = require("../models/Transaction");
const categoryUtils_1 = require("../utils/categoryUtils");
const router = (0, express_1.Router)();
// Rota para criar uma nova transação
router.post('/transactions', async (req, res) => {
    const { userId, type, amount, description } = req.body;
    try {
        if (!userId || !type || !amount || !description) {
            return res.status(400).json({ message: 'Dados inválidos.' });
        }
        const category = (0, categoryUtils_1.getCategoryFromDescription)(description);
        const newTransaction = new Transaction_1.Transaction({ userId, type, amount, description, category });
        await newTransaction.save();
        res.status(201).json(newTransaction);
    }
    catch (error) {
        res.status(500).json({ message: 'Erro ao salvar a transação.', error });
    }
});
// Rota para buscar todas as transações de um usuário específico
router.get('/transactions/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const transactions = await Transaction_1.Transaction.find({
            $or: [
                { userId },
                { userId: { $exists: false } }
            ]
        }).sort({ createdAt: -1 });
        const totalIncome = transactions
            .filter((t) => t.type === 'income')
            .reduce((sum, t) => sum + t.amount, 0);
        const totalExpenses = transactions
            .filter((t) => t.type === 'expense')
            .reduce((sum, t) => sum + t.amount, 0);
        const balance = totalIncome - totalExpenses;
        const categorySummary = {};
        transactions
            .filter((t) => t.type === 'expense')
            .forEach((t) => {
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
    }
    catch (error) {
        res.status(500).json({ message: 'Erro ao buscar as transações.', error });
    }
});
// Rota para excluir uma transação específica de um usuário
router.delete('/transactions/:userId/:id', async (req, res) => {
    const { userId, id } = req.params;
    try {
        const transaction = await Transaction_1.Transaction.findOneAndDelete({
            _id: id,
            $or: [
                { userId },
                { userId: { $exists: false } }
            ]
        });
        if (!transaction) {
            return res.status(404).json({ message: 'Transação não encontrada ou não pertence a este usuário.' });
        }
        res.status(200).json({ message: 'Transação excluída com sucesso.', transaction });
    }
    catch (error) {
        res.status(500).json({ message: 'Erro ao excluir a transação.', error });
    }
});
exports.default = router;
