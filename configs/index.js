import 'dotenv/config'

const MONGODB_PASSWORD = process.env.MONGODB_PASSWORD || 'wright'
const MONGODB_USER = process.env.MONGODB_USER || 'resq'
if(process.env.MONGODB_PASSWORD && process.env.MONGODB_USER){
    console.log("DATABASE CAN READ AND WRITE");
}else{
    console.log("READ ONLY DATABASE")
}
export const MONGODB_URL = `mongodb://${MONGODB_USER}:${MONGODB_PASSWORD}@34.69.252.224:27017/`