import 'dotenv/config'

const MONGODB_PASSWORD = process.env.MONGODB_PASSWORD || 'wright'
const MONGODB_USER = process.env.MONGODB_USER || 'resq'
const MONGODB_IP = process.env.MONGODB_IP || '127.0.0.1'

export const MONGODB_URL = `mongodb://${MONGODB_USER}:${MONGODB_PASSWORD}@${MONGODB_IP}:27017/`