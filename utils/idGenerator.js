
 const customIdGenerator = async (id) => {
    // Get current date and time in YYYYMMDDHHMMSS format
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

    const random3Digit = Math.floor(100 + Math.random() * 900); 
        // Combine id, timestamp, and random 3-digit number
    return `${id}-${timestamp}-${random3Digit}`.toUpperCase();
};

export {customIdGenerator}