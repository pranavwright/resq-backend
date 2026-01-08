
import {
    authenticatedUser,
    isUserAllowed,
} from "../../middleware/authMiddleware.js";

const statsRoute = (fastify, options, done) => {
    const isAdmin = {
        preHandler: [
            (req, reply) => isUserAllowed(fastify, req, reply, ["admin", "superAdmin", "stat"]),
        ],
    };

    fastify.get("/admin/dashboard-stats", isAdmin, async (req, reply) => {
        try {
            const { disasterId } = req.query;
            if (!disasterId) return reply.status(400).send({ message: "disasterId is required" });

            // 1. Member Stats
            const memberStats = await fastify.mongo.db.collection("members")
                .aggregate([
                    { $match: { disasterId } },
                    { $group: { _id: "$status", count: { $sum: 1 } } }
                ]).toArray();

            // 2. Camp Stats (Capacity vs Occupied)
            const campStats = await fastify.mongo.db.collection("camps")
                .aggregate([
                    { $match: { disasterId, status: "active" } },
                    // Join with members to count occupied
                    // Note: This relies on members having campId. 
                    // If members don't have campId, we might need to join via Family, which is expensive.
                    // Assuming we are enforcing campId on members/families based on earlier tasks.
                    // But wait, in previous task I added filtering by campId in families route, 
                    // which implies we can link them.
                    // The easiest way is to lookup families then members, or if we denormalized campId to members.
                    // Let's assume for now we look up families in the camp, then sum members.
                    /* 
                       Re-checking family schema/route:
                       In `familyRoute`: `if (campId) pipeline.push({ $match: { "members.campId": campId } });`
                       It seems members have `campId`.
                    */
                    {
                        $lookup: {
                            from: "members", // Assuming members have campId
                            let: { campId: "$_id" },
                            pipeline: [
                                { $match: { $expr: { $and: [{ $eq: ["$campId", "$$campId"] }, { $eq: ["$disasterId", disasterId] }] } } },
                                { $count: "count" }
                            ],
                            as: "occupiedData"
                        }
                    },
                    {
                        $project: {
                            name: 1,
                            capacity: 1,
                            occupied: { $ifNull: [{ $arrayElemAt: ["$occupiedData.count", 0] }, 0] }
                        }
                    }
                ]).toArray();

            // 3. Collection Point Stats (Inventory Count)
            const cpStats = await fastify.mongo.db.collection("collectionPoints")
                .aggregate([
                    { $match: { disasterId, status: "active" } },
                    {
                        $lookup: {
                            from: "point_inventory",
                            localField: "_id",
                            foreignField: "collectionPointId",
                            as: "inventory"
                        }
                    },
                    {
                        $project: {
                            name: 1,
                            totalItems: { $sum: "$inventory.quantity" }
                        }
                    }
                ]).toArray();

            // 4. Donation Trends (Last 7 Days)
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            sevenDaysAgo.setHours(0, 0, 0, 0);

            const donationTrends = await fastify.mongo.db.collection("generalDonation")
                .aggregate([
                    { $match: { disasterId, donatedAt: { $gte: sevenDaysAgo } } },
                    {
                        $group: {
                            _id: { $dateToString: { format: "%Y-%m-%d", date: "$donatedAt" } },
                            count: { $sum: 1 }
                        }
                    },
                    { $sort: { _id: 1 } }
                ]).toArray();

            reply.send({
                memberStats,
                campStats,
                cpStats,
                donationTrends
            });

        } catch (error) {
            console.error("Stats Error:", error);
            reply.status(500).send({ message: "Internal Server Error" });
        }
    });

    done();
};

export default statsRoute;
