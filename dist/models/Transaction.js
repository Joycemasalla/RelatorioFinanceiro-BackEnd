"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Transaction = void 0;
const mongoose_1 = require("mongoose");
const transactionSchema = new mongoose_1.Schema({
    userId: { type: String }, // 'required: true' foi removido
    type: { type: String, required: true, enum: ['income', 'expense'] },
    amount: { type: Number, required: true },
    description: { type: String, required: true },
    category: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
});
exports.Transaction = (0, mongoose_1.model)('Transaction', transactionSchema);
