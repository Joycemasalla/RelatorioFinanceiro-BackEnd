"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const Transaction_1 = require("./models/Transaction");
const UserMapping_1 = require("./models/UserMapping");
const categoryUtils_1 = require("./utils/categoryUtils");
const date_fns_1 = require("date-fns");
const dotenv_1 = __importDefault(require("dotenv"));
const axios_1 = __importDefault(require("axios"));
const uuid_1 = require("uuid");
dotenv_1.default.config();
const router = (0, express_1.Router)();
const API_TOKEN = process.env.WHATSAPP_API_TOKEN;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
console.log('🔑 Configurações do Webhook:');
console.log('API_TOKEN:', API_TOKEN ? 'Configurado' : '❌ Não configurado');
console.log('VERIFY_TOKEN:', VERIFY_TOKEN ? 'Configurado' : '❌ Não configurado');
// Rota para verificação do webhook
router.get('/', (req, res) => {
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
        }
        else {
            console.log('❌ Falha na verificação do webhook - token incorreto');
            res.status(403).send('Forbidden - Token incorreto');
        }
    }
    else {
        console.log('❌ Dados de verificação inválidos');
        res.status(400).send('Bad Request - Dados inválidos');
    }
});
// Rota para receber mensagens do WhatsApp
router.post('/', async (req, res) => {
    var _a, _b;
    console.log('📨 Mensagem recebida:', JSON.stringify(req.body, null, 2));
    const data = req.body;
    if (data.object === 'whatsapp_business_account') {
        try {
            for (const entry of data.entry) {
                for (const change of entry.changes) {
                    if (change.value.messages) {
                        for (const message of change.value.messages) {
                            const incomingMessage = (_a = message.text) === null || _a === void 0 ? void 0 : _a.body;
                            const waId = message.from;
                            console.log('📱 Processando mensagem:', { waId, message: incomingMessage });
                            if (!incomingMessage || !waId) {
                                console.log('❌ Mensagem ou WaId inválido');
                                continue;
                            }
                            const lowerCaseMessage = incomingMessage.toLowerCase().trim();
                            let userMapping = await UserMapping_1.UserMapping.findOne({ waId });
                            let userId;
                            if (!userMapping) {
                                const newDashboardUserId = (0, uuid_1.v4)();
                                userMapping = new UserMapping_1.UserMapping({ waId, dashboardUserId: newDashboardUserId });
                                await userMapping.save();
                                userId = newDashboardUserId;
                                console.log('👤 Novo usuário criado:', userId);
                            }
                            else {
                                userId = userMapping.dashboardUserId;
                                console.log('👤 Usuário existente:', userId);
                            }
                            // Função para enviar mensagem
                            const sendMessage = async (body) => {
                                try {
                                    const url = `https://graph.facebook.com/v20.0/${change.value.metadata.phone_number_id}/messages`;
                                    const response = await axios_1.default.post(url, {
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
                                }
                                catch (error) {
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
                                        startDate = (0, date_fns_1.startOfDay)(new Date());
                                        endDate = (0, date_fns_1.endOfDay)(new Date());
                                        periodText = 'hoje';
                                    }
                                    else if (lowerCaseMessage.includes('mês') || lowerCaseMessage.includes('mes')) {
                                        startDate = (0, date_fns_1.startOfMonth)(new Date());
                                        endDate = (0, date_fns_1.endOfMonth)(new Date());
                                        periodText = 'este mês';
                                    }
                                    else {
                                        startDate = (0, date_fns_1.startOfMonth)(new Date());
                                        endDate = (0, date_fns_1.endOfMonth)(new Date());
                                        periodText = 'este mês';
                                    }
                                    const transactions = await Transaction_1.Transaction.find({
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
                                    }
                                    else {
                                        reportMessage += 'Nenhuma transação encontrada para este período.';
                                    }
                                    await sendMessage(reportMessage);
                                    continue;
                                }
                                catch (error) {
                                    console.error('Erro ao gerar relatório:', error);
                                    await sendMessage('Erro ao gerar relatório. Tente novamente.');
                                    continue;
                                }
                            }
                            // Lógica para apagar transação
                            if (lowerCaseMessage.startsWith('apagar ')) {
                                const transactionId = lowerCaseMessage.replace('apagar ', '').trim();
                                try {
                                    const deletedTransaction = await Transaction_1.Transaction.findOneAndDelete({
                                        _id: transactionId,
                                        userId
                                    });
                                    if (deletedTransaction) {
                                        await sendMessage(`✅ Transação apagada com sucesso!\nR$ ${deletedTransaction.amount.toFixed(2)} - ${deletedTransaction.description}`);
                                    }
                                    else {
                                        await sendMessage('❌ Transação não encontrada. Verifique o ID.');
                                    }
                                    continue;
                                }
                                catch (error) {
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
                                    const description = ((_b = match[2]) === null || _b === void 0 ? void 0 : _b.trim()) || 'Transação';
                                    const type = incomeKeywords.some(keyword => lowerCaseMessage.includes(keyword)) ? 'income' : 'expense';
                                    const category = (0, categoryUtils_1.getCategoryFromDescription)(description);
                                    const newTransaction = new Transaction_1.Transaction({ userId, type, amount, description, category });
                                    await newTransaction.save();
                                    const confirmationMessage = `✅ Transação salva com sucesso!\nDetalhes:\n- Tipo: ${type === 'expense' ? 'Gasto' : 'Receita'}\n- Valor: R$ ${amount.toFixed(2)}\n- Descrição: ${description}\n- Categoria: ${category}\n- ID: ${newTransaction._id}`;
                                    await sendMessage(confirmationMessage);
                                }
                                catch (error) {
                                    console.error('Erro ao salvar transação:', error);
                                    await sendMessage('Erro ao salvar transação. Tente novamente.');
                                }
                            }
                            else {
                                await sendMessage("❓ Não entendi sua solicitação. Envie 'ajuda' para ver a lista de comandos.");
                            }
                        }
                    }
                }
            }
            res.status(200).json({ status: 'success' });
        }
        catch (error) {
            console.error('❌ Erro ao processar webhook do WhatsApp:', error);
            res.status(500).send('Server error');
        }
    }
    else {
        res.status(400).json({ error: 'Invalid request' });
    }
});
exports.default = router;
