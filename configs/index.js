import 'dotenv/config'

const MONGODB_PASSWORD = process.env.MONGODB_PASSWORD || 'I3l1hYGW344I3Bm1'
const MONGODB_USER = process.env.MONGODB_USER || 'test_read'
if(process.env.MONGODB_PASSWORD && process.env.MONGODB_USER){
    console.log("DATABASE CAN READ AND WRITE");
}else{
    console.log("READ ONLY DATABASE")
}
export const MONGODB_URL = `mongodb+srv://${MONGODB_USER}:${MONGODB_PASSWORD}@cluster0.ubiawkg.mongodb.net/`
