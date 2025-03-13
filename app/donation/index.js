/**
 * @param {import("fastify").FastifyInstance} fastify The date
 * @param {import("fastify").FastifyPluginOptions} options The string
 * @param {*} done The string
 */

import {
  authenticatedUser,
  isUserAllowed,
} from "../../middleware/authMiddleware.js";
import { customIdGenerator } from "../../utils/idGenerator.js";

const donationRoute = (fastify, options, done) => {
  const isAuthUser = {
    preHandler: [(req, reply) => authenticatedUser(fastify, req, reply)],
  };

  const isDonationAdmin = {
    preHandler: [
      (req, reply) =>
        isUserAllowed(fastify, req, reply, ["collectionPointAdmin"]),
    ],
  };

  fastify.get("/items", async (req, reply) => {
    try {
        const {disasterId} = req.query;
      const list = await fastify.mongo.db
        .collection("items")
        .find(
          {disasterId},
          {
            project: {
              _id: 1,
              name: 1,
              description: 1,
              category: 1,
              unit: 1,
            },
          }
        )
        .toArray();
      reply.send(list);
    } catch (error) {
      reply.status(500).send({ message: error.message });
    }
  });


  fastify.post("/generalDonation", async (req, reply) => {
    try {
      const {
        name: donarName,
        email: donarEmail,
        address: donarAddress,
        items,
        disasterId
      } = req.body;
      if (
        !donarName ||
        !donarEmail ||
        !donarAddress ||
        !items ||
        !Array.isArray(items) ||
        items.length === 0
      ) {
        return reply.status(400).send({ message: "All fields are required" });
      }
      if (Array.isArray(items) && items.length === 0) {
        return reply.status(400).send({ message: "Items are required" });
      }
      let donaItems = [];
      for (const item of items) {
        let newItem;
        if (!item.itemId) {
          newItem = await fastify.mongo.db.collection("items").insertOne({
            _id: customIdGenerator("ITM"),
            name: item.name,
            description: item.description,
            category: item.category,
            unit: item.unit,
            quantity: 0,
            disasterId
          });
        }
        donaItems.push({
          itemId: item.itemId || newItem.insertedId,
          quantity: item.quantity,
        });
      }
      await fastify.mongo.db.collection("generalDonation").insertOne({
        _id: customIdGenerator("GDN"),
        donarName,
        donarEmail,
        donarAddress,
        items: newItem,
        status: "pending",
        disasterId,
        donatedAt: new Date(),
      });
      reply.status(200).send({ message: "Donation added successfully" });
    } catch (error) {
      reply.status(500).send({ message: error.message });
    }
  });
  fastify.post("/confromDonation", isDonationAdmin, async (req, reply) => {
    try {
      const { donationId, status } = req.body;
      if (!donationId || !status) {
        return reply.status(400).send({ message: "All fields are required" });
      }

      await fastify.mongo.db
        .collection("generalDonation")
        .updateOne({ _id: donationId, disasterId }, { $set: { status } });
    } catch (error) {
      reply.status(500).send({ message: error.message });
    }
  });
  fastify.post("/downloadDonation", isDonationAdmin, async (req, reply) => {
    try {
      const { donationId, status,disasterId } = req.body;
      if (!donationId || !status) {
        return reply.status(400).send({ message: "All fields are required" });
      }
      const donation = await fastify.mongo.db
        .collection("generalDonation")
        .findOne({ _id: donationId ,disasterId});
      if (!donation) {
        return reply.status(404).send({ message: "Donation not found" });
      }
      if (donation.status === "completed") {
        return reply
          .status(400)
          .send({ message: "Donation already completed" });
      }
      for (const item of donation.items) {
        await fastify.mongo.db
          .collection("items")
          .updateOne(
            { _id: item.itemId,disasterId },
            { $inc: { quantity: item.quantity } }
          );
      }
      await fastify.mongo.db
        .collection("generalDonation")
        .updateOne({ _id: donationId,disasterId }, { $set: { status } });
      reply.status(200).send({ message: "Donation status updated" });
    } catch (error) {
      reply.status(500).send({ message: error.message });
    }
  });

  fastify.get('/getGeneralDonation', isDonationAdmin, async (req, reply) => {
    try {
      const donation = await fastify.mongo.db
        .collection("generalDonation")
        .find(
          {disasterId: req.query.disasterId},
          {
            project: {
              _id: 1,
              donarName: 1,
              donarEmail: 1,
              donarAddress: 1,
              items: 1,
              status: 1,
              donatedAt: 1,
            },
          }
        )
        .toArray();
      reply.send(donation);
    } catch (error) {
      reply.status(500).send({ message: error.message });
    }
  })

  done();
};
export default donationRoute;
