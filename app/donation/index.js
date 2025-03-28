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
import mailSender from "../../utils/mailSender.js";

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
      const { disasterId } = req.query;
      const list = await fastify.mongo.db
        .collection("items")
        .find(
          { disasterId },
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
      reply.send({ list });
    } catch (error) {
      reply.status(500).send({ message: error.message });
    }
  });
  fastify.get("/inventoryItems", isDonationAdmin, async (req, reply) => {
    try {
      const { disasterId } = req.query;
      const list = await fastify.mongo.db
        .collection("items")
        .find({ disasterId })
        .toArray();
      reply.send({ list });
    } catch (error) {
      reply.status(500).send({ message: error.message });
    }
  });
  fastify.post("/updateItemLocation", isDonationAdmin, async (req, reply) => {
    try {
      const { itemId, room, disasterId } = req.body;
      if (!itemId || !room || !disasterId) {
        return reply.status(400).send({ message: "All fields are required" });
      }
      await fastify.mongo.db
        .collection("items")
        .updateOne({ _id: itemId, disasterId }, { $set: { room } });
      reply.send({ message: "updated successfully" });
    } catch (error) {
      reply
        .status(500)
        .send({ message: error.message || "internal server error" });
    }
  });
  fastify.get(
    "/generalDonationRequest",
    isDonationAdmin,
    async (req, reply) => {
      try {
        const { disasterId } = req.query;
        const list = await fastify.mongo.db
          .collection("generalDonation")
          .aggregate([
            {
              $match: {
                disasterId: disasterId,
              },
            },

            {
              $lookup: {
                from: "items",
                localField: "donatedItems.itemId",
                foreignField: "_id",
                as: "donated",
              },
            },
          ])
          .toArray();
        const formattedList = list.map((donation) => {
          const donatedItems = donation.donated.map((item) => {
            const matchedItem = donation.donatedItems.find(
              (donatedItem) => donatedItem.itemId === item._id
            );
            return {
              ...item,
              quantity: matchedItem ? matchedItem.quantity : 0,
            };
          });
          return {
            ...donation,
            donatedItems,
          };
        });
        reply.send({ list: formattedList });
      } catch (error) {
        reply.status(500).send({ message: error.message });
      }
    }
  );

  fastify.post("/generalDonation", async (req, reply) => {
    try {
      const {
        name: donarName,
        email: donarEmail,
        address: donarAddress,
        phone: donarPhone,
        items,
        disasterId,
        donationDate,
      } = req.body;

      if (
        !donarName ||
        !donarEmail ||
        !items ||
        !Array.isArray(items) ||
        items.length === 0
      ) {
        return reply.status(400).send({ message: "All fields are required" });
      }

      let donatedItems = [];
      let newItemIds = [];

      for (const item of items) {
        let itemIdToUse = item.itemId;
        if (!item.itemId) {
          const newItem = await fastify.mongo.db.collection("items").insertOne({
            _id: customIdGenerator("ITM"),
            name: item.name,
            description: item.description,
            category: item.category,
            unit: item.unit,
            quantity: 0,
            disasterId,
          });
          itemIdToUse = newItem.insertedId;
          newItemIds.push(itemIdToUse);
        }

        donatedItems.push({
          itemId: itemIdToUse,
          quantity: item.quantity,
        });
      }

       await fastify.mongo.db
        .collection("generalDonation")
        .insertOne({
          _id: customIdGenerator("GDN"),
          donarName,
          donarEmail,
          donarAddress,
          status: "pending",
          disasterId,
          donarPhone,
          donatedAt: new Date(),
          donatedItems,
          donationDate,
        });

      // Fetch all items that were part of the donation for the email
      const allDonatedItemIds = donatedItems.map((item) => item.itemId);
      const donationItemsForEmail = await fastify.mongo.db
        .collection("items")
        .find({ _id: { $in: allDonatedItemIds } })
        .toArray();

      try {
        await mailSender.sendDonationRequestMail(donarEmail, {
          donationItems: donationItemsForEmail.map((item) => ({
            name: item.name,
            quantity: donatedItems.find(
              (donatedItem) => donatedItem.itemId === item._id
            ).quantity,
            category: item.category,
            unit: item.unit,
          })),
          donarName,
          donarEmail,
          donarAddress,
          status: "pending",
          disasterId,
          donarPhone,
          donatedAt: new Date(),
        });
        console.log(`Donation request email sent to ${donarEmail}`);
      } catch (emailError) {
        console.error("Error sending donation request email:", emailError);
        return reply
          .status(200)
          .send({ message: "Donation added successfully but mail did't send" });
      }

      reply.status(200).send({ message: "Donation added successfully" });
    } catch (error) {
      console.error("Error processing donation:", error);
      reply.status(500).send({ message: error.message });
    }
  });

  fastify.post("/updateDonation", isDonationAdmin, async (req, reply) => {
    try {
      const { donationId, status, disasterId, donationDate } = req.body;
      if (!donationId || !status) {
        return reply.status(400).send({ message: "All fields are required" });
      }

      await fastify.mongo.db
        .collection("generalDonation")
        .updateOne(
          { _id: donationId, disasterId },
          {
            $set: {
              status,
              ...(donationDate && { donationDate }),
              ...(status == "processed" && { processedAt: new Date() }),
            },
          }
        );

      const donation = await fastify.mongo.db
        .collection("generalDonation")
        .findOne({ _id: donationId, disasterId });

      if (!donation) {
        return reply.status(404).send({ message: "Donation not found" });
      }
      const donationItemsForEmail = await fastify.mongo.db
        .collection("items")
        .find({
          _id: { $in: donation.donatedItems.map((item) => item.itemId) },
        })
        .toArray();
      if (status == "confirm") {
        try {
          await mailSender.sendDonationConfomationMail(donation.donarEmail, {
            donationItems: donationItemsForEmail,
            donarName: donation.donarName,
            donarEmail: donation.donarEmail,
            donarAddress: donation.donarAddress,
            status,
            disasterId,
            donarPhone: donation.donarPhone || "",
            estimate: donationDate ? new Date(donationDate) : new Date(),
          });
        } catch (error) {
          console.error("Error sending donation request email:", error);
          return reply.status(200).send({
            message: "Donation added successfully but mail did't send",
          });
        }
      } else if (status == "processed") {
        for (const item of donation.donatedItems) {
          await fastify.mongo.db.collection("items").updateOne(
            { _id: item.itemId },
            {
              $inc: {
                quantity: parseInt(item.quantity),
              },
            }
          );
        }
        try {
          await mailSender.sendDonationDispatchMail(donation.donarEmail, {
            donationItems: donationItemsForEmail,
            donarName: donation.donarName,
            donarEmail: donation.donarEmail,
            donarAddress: donation.donarAddress,
            status,
            disasterId,
            donarPhone: donation.donarPhone || "",
            deleverdAt: new Date(),
          });
        } catch (error) {
          console.error("Error sending donation request email:", error);
          return reply.status(200).send({
            message: "Donation added successfully but mail did't send",
          });
        }
      }

      reply.status(200).send({ message: "Donation status updated" });
    } catch (error) {
      reply.status(500).send({ message: error.message });
    }
  });

  fastify.get("/getGeneralDonation", isDonationAdmin, async (req, reply) => {
    try {
      const donation = await fastify.mongo.db
        .collection("generalDonation")
        .find(
          { disasterId: req.query.disasterId },
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
  });

  done();
};
export default donationRoute;
