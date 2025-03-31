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
  const isCampAdmin = {
    preHandler: [
      (req, reply) => isUserAllowed(fastify, req, reply, ["campAdmin"]),
    ],
  };

  fastify.get("/items", async (req, reply) => {
    try {
      const { disasterId } = req.query;
      const list = await fastify.mongo.db
        .collection("inventory")
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
        .collection("inventory")
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
        .collection("inventory")
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
                from: "inventory",
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
        confirmDate,
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
          const newItem = await fastify.mongo.db
            .collection("inventory")
            .insertOne({
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

      await fastify.mongo.db.collection("generalDonation").insertOne({
        _id: customIdGenerator("GDN"),
        donarName,
        donarEmail,
        donarAddress,
        status: "pending",
        disasterId,
        donarPhone,
        donatedAt: new Date(),
        donatedItems,
        confirmDate,
      });

      // Fetch all items that were part of the donation for the email
      const allDonatedItemIds = donatedItems.map((item) => item.itemId);
      const donationItemsForEmail = await fastify.mongo.db
        .collection("inventory")
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
      const { donationId, status, disasterId, confirmDate } = req.body;
      if (!donationId || !status) {
        return reply.status(400).send({ message: "All fields are required" });
      }

      await fastify.mongo.db.collection("generalDonation").updateOne(
        { _id: donationId, disasterId },
        {
          $set: {
            status,
            ...(confirmDate && { confirmDate: new Date(confirmDate) }),
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
        .collection("inventory")
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
            estimate: confirmDate ? new Date(confirmDate) : new Date(),
          });
        } catch (error) {
          console.error("Error sending donation request email:", error);
          return reply.status(200).send({
            message: "Donation added successfully but mail did't send",
          });
        }
      } else if (status == "processed") {
        for (const item of donation.donatedItems) {
          await fastify.mongo.db.collection("inventory").updateOne(
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

  fastify.get("/campDonationRequest", isDonationAdmin, async (req, reply) => {
    try {
      const { disasterId } = req.query;

      const list = await fastify.mongo.db
        .collection("campRequests")
        .aggregate([
          {
            $match: {
              disasterId: disasterId,
            },
          },

          {
            $lookup: {
              from: "inventory",
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
  });

  fastify.get(
    "/getIndividualAvailableItems",
    isCampAdmin,
    async (req, reply) => {
        try {
            const { disasterId, item } = req.query;

            if (!disasterId || !item || !item._id || !item.quantity) {
                return reply.status(400).send({ message: "Disaster ID, item ID, and quantity are required" });
            }

            const itemIdToCheck = item._id;
            const requestedQuantity = item.quantity;

            // Fetch current camp's inventory for the specific item
            const currentCampInventory = await fastify.mongo.db
                .collection("inventory")
                .findOne({ disasterId, itemId: itemIdToCheck });

            const availableInCurrentCamp = currentCampInventory ? currentCampInventory.quantity : 0;

            // Fetch pending/approved camp requests from other camps for this item
            const otherCampRequests = await fastify.mongo.db
                .collection("campRequest")
                .find({
                    disasterId,
                    status: { $in: ["approved", "arrived"] },
                    "items.itemId": itemIdToCheck,
                })
                .project({ items: 1 })
                .toArray();

            let reservedInOtherCamps = 0;
            otherCampRequests.forEach((request) => {
                const requestedInOtherCamp = request.items.find((i) => i.itemId === itemIdToCheck);
                if (requestedInOtherCamp) {
                    reservedInOtherCamps += requestedInOtherCamp.quantity;
                }
            });

            const currentlyAvailable = availableInCurrentCamp - reservedInOtherCamps;

            if (requestedQuantity <= currentlyAvailable) {
                return reply.status(200).send({ message: "in stock" });
            } else {
                const avaliablity = await fastify.mongo.db
                    .collection("donationRequest")
                    .find({
                        disasterId,
                        "items.itemId": itemIdToCheck,
                        status: { $in: ["confirmed", "arrived"] },
                    }, { projection: { items: 1, status: 1, confirmDate: 1 } })
                    .toArray();
                return reply.status(200).send({ message: "out of stock", avaliablity });
            }

        } catch (error) {
            reply.status(500).send({ message: error.message });
        }
    }
);

  fastify.get("/getAvailableItems", isCampAdmin, async (req, reply) => {
    try {
        const { disasterId, items: requestedItems } = req.query;
        let items = requestedItems;
        if (!disasterId || !items) {
            return reply.status(400).send({ message: "All fields are required" });
        }
        if (!Array.isArray(items)) {
            items = [items];
        }

        const itemIdsToCheck = items.map((x) => x.itemId);

        const currentCampInventoryMap = new Map(
            (
                await fastify.mongo.db
                    .collection("inventory")
                    .find({ disasterId, itemId: { $in: itemIdsToCheck } })
                    .toArray()
            ).map((item) => [item.itemId, item.quantity]) 
        );

        // Fetch pending/approved camp requests from other camps
        const otherCampRequests = await fastify.mongo.db
            .collection("campRequest")
            .find({
                disasterId,
                status: { $in: ["approved", "arrived"] }, 
                "items.itemId": { $in: itemIdsToCheck },
            })
            .project({ items: 1 })
            .toArray();

        const itemsWithStatus = await Promise.all(
            items.map(async (requestedItem) => {
                const availableInCurrentCamp = currentCampInventoryMap.get(requestedItem.itemId) || 0;
                let reservedInOtherCamps = 0;

                otherCampRequests.forEach((request) => {
                    const requestedInOtherCamp = request.items.find((i) => i.itemId === requestedItem.itemId);
                    if (requestedInOtherCamp) {
                        reservedInOtherCamps += requestedInOtherCamp.quantity;
                    }
                });

                const currentlyAvailable = availableInCurrentCamp - reservedInOtherCamps;

                if (requestedItem.quantity <= currentlyAvailable) {
                    return { ...requestedItem, status: "in stock" };
                } else {
                    try {
                        const avaliablity = await fastify.mongo.db
                            .collection("donationRequest")
                            .find({
                                disasterId,
                                "items.itemId": requestedItem.itemId,
                                status: { $in: ["confirmed", "arrived"] },
                            },{projection: { items: 1, status: 1, confirmDate: 1,  }})
                            .toArray();
                        return { ...requestedItem, status: "out of stock", avaliablity };
                    } catch (error) {
                        console.error(
                            `Error fetching donation requests for item ${requestedItem.itemId}:`,
                            error
                        );
                        return { ...requestedItem, status: "error", avaliablity: [] };
                    }
                }
            })
        );

        reply.send({ items: itemsWithStatus });
    } catch (error) {
        console.error("Error in /getAvailableItems:", error);
        reply.status(500).send({ message: error.message });
    }
});

  done();
};
export default donationRoute;
