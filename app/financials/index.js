
import { authenticatedUser } from "../../middleware/authMiddleware.js";
import { customIdGenerator } from "../../utils/idGenerator.js";

const financialsRoute = (fastify, options, done) => {

    // Auth Middleware might be needed, assuming authenticatedUser checks for valid token
    const isAuth = {
        preHandler: [(req, reply) => authenticatedUser(fastify, req, reply)],
    };

    fastify.post('/add', isAuth, async (req, reply) => {
        try {
            const {
                type, // 'house', 'fund'
                source, // 'nri', 'lsg', 'private', 'ngo', 'other'
                amount, // Number
                donorName,
                donorDetails,
                disasterId
            } = req.body;

            if (!disasterId || !type || !source) {
                return reply.status(400).send({ message: "Type, Source and Disaster ID are required" });
            }

            const record = {
                _id: customIdGenerator("FIN"),
                type,
                source,
                amount: Number(amount) || 0,
                donorName: donorName || 'Anonymous',
                donorDetails: donorDetails || '',
                disasterId,
                createdAt: new Date(),
                createdBy: req.user?._id || 'system'
            };

            await fastify.mongo.db.collection('financials').insertOne(record);
            reply.send({ message: "Record added successfully", id: record._id });

        } catch (error) {
            console.error("Error adding financial record:", error);
            reply.status(500).send({ message: error.message });
        }
    });

    fastify.get('/list', isAuth, async (req, reply) => {
        try {
            const { disasterId } = req.query;
            if (!disasterId) return reply.status(400).send({ message: "Disaster ID required" });

            const list = await fastify.mongo.db.collection('financials')
                .find({ disasterId })
                .sort({ createdAt: -1 })
                .toArray();

            reply.send({ list });
        } catch (error) {
            reply.status(500).send({ message: error.message });
        }
    });

    fastify.get('/stats', isAuth, async (req, reply) => {
        try {
            const { disasterId } = req.query;
            if (!disasterId) return reply.status(400).send({ message: "Disaster ID required" });

            // Aggregation pipeline to group by Type and Source
            const stats = await fastify.mongo.db.collection('financials').aggregate([
                { $match: { disasterId } },
                {
                    $group: {
                        _id: { type: "$type", source: "$source" },
                        totalAmount: { $sum: "$amount" },
                        count: { $sum: 1 }
                    }
                }
            ]).toArray();

            // Process stats into a friendlier format
            const summary = {
                totalFunds: 0,
                totalHouses: 0,
                bySource: {
                    nri: { funds: 0, houses: 0 },
                    lsg: { funds: 0, houses: 0 },
                    private: { funds: 0, houses: 0 },
                    other: { funds: 0, houses: 0 }
                }
            };

            stats.forEach(item => {
                const { type, source } = item._id;
                const srcKey = (source && summary.bySource[source.toLowerCase()]) ? source.toLowerCase() : 'other';

                if (type === 'fund') {
                    summary.totalFunds += item.totalAmount;
                    summary.bySource[srcKey].funds += item.totalAmount;
                } else if (type === 'house') {
                    // Assuming 'amount' for house might mean number of houses or cost. 
                    // Let's assume 'count' is what matters for "Number of Houses", but if user entered amount as cost, we track that too.
                    // Implementation Plan said "House/Money". 
                    // If type is house, 'amount' usually implies cost or 1 unit. 
                    // Let's treat 'count' as number of houses sponsored.
                    summary.totalHouses += item.count;
                    summary.bySource[srcKey].houses += item.count;
                }
            });

            reply.send({ summary });

        } catch (error) {
            reply.status(500).send({ message: error.message });
        }
    });

    done();
};

export default financialsRoute;
