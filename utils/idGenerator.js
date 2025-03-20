import { v4 as uuidv4 } from 'uuid';

 const customIdGenerator =  (id) => {
    // Get current date and time in YYYYMMDDHHMMSS format
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

    const random4Digit = uuidv4().slice(0, 4); 
    return `${id}-${timestamp}-${random4Digit}`.toUpperCase();
};

export {customIdGenerator}