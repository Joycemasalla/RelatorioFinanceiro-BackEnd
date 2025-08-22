import { Schema, model, Document } from 'mongoose';

export interface IUserMapping extends Document {
  waId: string;
  dashboardUserId: string;
}

const userMappingSchema = new Schema<IUserMapping>({
  waId: { type: String, required: true, unique: true },
  dashboardUserId: { type: String, required: true, unique: true },
});

export const UserMapping = model<IUserMapping>('UserMapping', userMappingSchema);