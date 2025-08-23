"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserMapping = void 0;
const mongoose_1 = require("mongoose");
const userMappingSchema = new mongoose_1.Schema({
    waId: { type: String, required: true, unique: true },
    dashboardUserId: { type: String, required: true, unique: true },
});
exports.UserMapping = (0, mongoose_1.model)('UserMapping', userMappingSchema);
