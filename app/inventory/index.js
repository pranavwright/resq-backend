
import { authenticatedUser, isUserAllowed } from "../../middleware/authMiddleware.js";
import { customIdGenerator } from "../../utils/idGenerator.js";

const inventoryRoute = (fastify, options, done) => {
    // Middleware
    const isAuth = {
        preHandler: [(req, reply) => authenticatedUser(fastify, req, reply)],
    };

    fastify.get("/list", isAuth, async (req, reply) => {
        try {
            const { disasterId, collectionPointId } = req.query;

            if (!disasterId) {
                return reply.status(400).send({ message: "Disaster ID is required" });
            }

            let list = [];

            if (collectionPointId) {
                // Fetch inventory for specific Collection Point
                list = await fastify.mongo.db.collection("point_inventory").aggregate([
                    { $match: { disasterId, collectionPointId } },
                    {
                        $lookup: {
                            from: "catalog_items",
                            localField: "itemId",
                            foreignField: "_id",
                            as: "details"
                        }
                    },
                    { $unwind: "$details" },
                    {
                        $project: {
                            _id: "$details._id", // Return Catalog Item ID as main ID for consistency? Or Point Inventory ID? 
                            // Frontend expects _id to be the item's ID usually. 
                            // But for updates we might need point_inventory ID.
                            // Let's return _id as Point Inventory ID, and details._id as itemId.
                            pointInventoryId: "$_id",
                            itemId: "$details._id",
                            name: "$details.name",
                            category: "$details.category",
                            unit: "$details.unit",
                            description: "$details.description",
                            quantity: 1, // point_inventory has 'quantity' field
                        }
                    }
                ]).toArray();

                // Oops, I projected quantity: 1 but it's a field in point_inventory.
                // Re-doing project correctly.
            } else {
                // Global View (e.g. for creating requests, we view Catalog)
                // OR aggregated stock? 
                // For now, let's return Catalog Items (definitions)
                list = await fastify.mongo.db.collection("catalog_items").find({ disasterId }).toArray();
            }

            // Correct projection for CP Inventory
            if (collectionPointId) {
                list = await fastify.mongo.db.collection("point_inventory").aggregate([
                    { $match: { disasterId, collectionPointId } },
                    {
                        $lookup: {
                            from: "catalog_items",
                            localField: "itemId",
                            foreignField: "_id",
                            as: "details"
                        }
                    },
                    { $unwind: "$details" },
                    {
                        $project: {
                            _id: "$details._id", // Keeping Item ID as _id for frontend compatibility in lists
                            pointInventoryId: "$_id",
                            name: "$details.name",
                            category: "$details.category",
                            unit: "$details.unit",
                            quantity: "$quantity"
                        }
                    }
                ]).toArray();
            }

            reply.send(list);
        } catch (error) {
            console.error(error);
            reply.status(500).send({ message: "Internal Server Error" });
        }
    });

    done();
};

export default inventoryRoute;
