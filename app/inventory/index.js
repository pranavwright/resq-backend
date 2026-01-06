
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

            // Construct query
            const query = { disasterId };

            // NOTE: Currently inventory is global per disaster. 
            // If/When we support per-CP inventory (e.g. by adding collectionPointId to inventory items),
            // uncomment the line below.
            if (collectionPointId) {
                query.collectionPointId = collectionPointId;
            }

            const list = await fastify.mongo.db.collection("inventory").find(query).toArray();
            reply.send(list);
        } catch (error) {
            console.error(error);
            reply.status(500).send({ message: "Internal Server Error" });
        }
    });

    done();
};

export default inventoryRoute;
