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
            projection: {
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

  fastify.get(
    "/allCampDonationRequest",
    isDonationAdmin,
    async (req, reply) => {
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
    }
  );

  fastify.get(
    "/getIndividualAvailableItems",
    isCampAdmin,
    async (req, reply) => {
      try {
        const { disasterId, item: items } = req.query;
        let item = JSON.parse(items);

        if (!disasterId || !item || !item._id || !item.quantity) {
          return reply.status(400).send({
            message: "Disaster ID, item ID, and quantity are required",
          });
        }

        const itemIdToCheck = item._id;
        const requestedQuantity = item.quantity;

        // Fetch current camp's inventory for the specific item
        const currentCampInventory = await fastify.mongo.db
          .collection("inventory")
          .findOne({ disasterId, _id: itemIdToCheck });

        const availableInCurrentCamp = currentCampInventory
          ? currentCampInventory.quantity
          : 0;

        // Fetch pending/approved camp requests from other camps for this item
        const otherCampRequests = await fastify.mongo.db
          .collection("campRequests")
          .find({
            disasterId,
            status: { $in: ["approved", "arrived"] },
            "items.itemId": itemIdToCheck,
          })
          .project({ items: 1, campId: 1, status: 1, pickUpDate: 1 })
          .toArray();

        let reservedInOtherCamps = 0;
        const otherCampReservations = [];

        otherCampRequests.forEach((request) => {
          const requestedInOtherCamp = request.items.find(
            (i) => i.itemId === itemIdToCheck
          );
          if (requestedInOtherCamp) {
            const reservedQuantity = parseInt(requestedInOtherCamp.quantity);
            reservedInOtherCamps += reservedQuantity;

            // Add detailed reservation info
            otherCampReservations.push({
              campId: request.campId,
              quantity: reservedQuantity,
              status: request.status,
              pickUpDate: request.pickUpDate || null,
            });
          }
        });

        // Subtract reserved items from the available stock in current camp
        const currentlyAvailable = Math.max(
          0,
          availableInCurrentCamp - reservedInOtherCamps
        );

        // If the requested quantity is available, return in-stock message
        if (requestedQuantity <= currentlyAvailable) {
          return reply.status(200).send({
            message: "in stock",
            availableSoon: [],
            availableInCurrentCamp,
            reservedInOtherCamps,
            otherCampReservations,
            currentlyAvailable,
            totalAvailableAfterDonations: currentlyAvailable,
            requestAvailableAfterDays: 0,
          });
        } else {
          // Fetch availability details from donations
          const availability = await fastify.mongo.db
            .collection("generalDonation")
            .find(
              {
                disasterId,
                "donatedItems.itemId": itemIdToCheck,
                status: { $in: ["confirmed", "arrived"] },
              },
              { projection: { donatedItems: 1, status: 1, confirmDate: 1 } }
            )
            .toArray();

          availability.sort((a, b) => {
            const dateA = new Date(a.confirmDate || Date.now());
            const dateB = new Date(b.confirmDate || Date.now());
            return dateA - dateB;
          });

          let quantityNeeded = requestedQuantity - currentlyAvailable;
          let totalAvailableFromDonations = 0;
          const availableSoon = [];
          const today = new Date();

          for (const donation of availability) {
            const donationItem = donation.donatedItems.find(
              (item) => item.itemId === itemIdToCheck
            );
            if (donationItem) {
              const availableQuantity = parseInt(donationItem.quantity);
              if (availableQuantity > 0) {
                // Calculate days until available
                const confirmDate = donation.confirmDate
                  ? new Date(donation.confirmDate)
                  : today;
                const daysUntilAvailable = Math.max(
                  0,
                  Math.ceil((confirmDate - today) / (1000 * 60 * 60 * 24))
                );

                // First prioritize filling the needed quantity
                if (quantityNeeded > 0) {
                  const addQuantity = Math.min(
                    availableQuantity,
                    quantityNeeded
                  );
                  availableSoon.push({
                    quantity: addQuantity,
                    status: donation.status,
                    confirmDate: donation.confirmDate,
                    daysUntilAvailable,
                    donation: {
                      _id: donation._id,
                      status: donation.status,
                      confirmDate: donation.confirmDate,
                      donatedItems: [donationItem],
                    },
                  });
                  totalAvailableFromDonations += addQuantity;
                  quantityNeeded -= addQuantity;
                }
                // Then add any additional available quantities
                else {
                  availableSoon.push({
                    quantity: availableQuantity,
                    status: donation.status,
                    confirmDate: donation.confirmDate,
                    daysUntilAvailable,
                    donation: {
                      _id: donation._id,
                      status: donation.status,
                      confirmDate: donation.confirmDate,
                      donatedItems: [donationItem],
                    },
                  });
                  totalAvailableFromDonations += availableQuantity;
                }
              }
            }
          }

          // Get earliest expected availability date for the full requested quantity
          let requestAvailableAfterDays = 0;
          if (quantityNeeded <= 0 && availableSoon.length > 0) {
            // Sort by days until available
            availableSoon.sort(
              (a, b) => a.daysUntilAvailable - b.daysUntilAvailable
            );
            requestAvailableAfterDays = availableSoon[0].daysUntilAvailable;
          }

          return reply.status(200).send({
            message: "out of stock",
            availableSoon,
            availableInCurrentCamp,
            reservedInOtherCamps,
            otherCampReservations,
            currentlyAvailable,
            totalAvailableAfterDonations:
              currentlyAvailable + totalAvailableFromDonations,
            requestAvailableAfterDays,
            fullRequestAvailable: quantityNeeded <= 0,
          });
        }
      } catch (error) {
        console.error("Error in getIndividualAvailableItems:", error);
        reply.status(500).send({ message: error.message });
      }
    }
  );

  fastify.post("/campDonationRequest", isCampAdmin, async (req, reply) => {
    try {
      const { campId, disasterId, items, notes, priority, pickUpDate } =
        req.body;

      // Validate required fields
      if (
        !campId ||
        !disasterId ||
        !items ||
        !Array.isArray(items) ||
        items.length === 0
      ) {
        return reply.status(400).send({ message: "All fields are required" });
      }

      // Validate and log item IDs
      for (const item of items) {
        if (!item.itemId) {
          console.error("Missing itemId for item:", item);
          return reply
            .status(400)
            .send({ message: "Each item must have a valid itemId" });
        }
      }

      // Insert the camp donation request
      const result = await fastify.mongo.db
        .collection("campRequests")
        .insertOne({
          _id: customIdGenerator("CRQ"),
          campId,
          disasterId,
          items: items.map((item) => ({
            itemId: item.itemId,
            quantity: item.quantity,
          })),
          notes,
          priority,
          pickUpDate: pickUpDate ? new Date(pickUpDate) : null,
          status: "pending",
          createdAt: new Date(),
        });

      reply.status(200).send({ success: true, requestId: result.insertedId });
    } catch (error) {
      console.error("Error in /campDonationRequest:", error);
      reply.status(500).send({ message: error.message });
    }
  });

  fastify.get("/campDonationRequest", isCampAdmin, async (req, reply) => {
    try {
      const { disasterId, campId } = req.query;
      if (!disasterId || !campId) {
        return reply.status(400).send({ message: "All fields are required" });
      }
      const requests = await fastify.mongo.db
        .collection("campRequests")
        .aggregate([
          { $match: { disasterId, campId } },
          {
            $lookup: {
              from: "inventory",
              localField: "items.itemId",
              foreignField: "_id",
              as: "invetory",
            },
          },
          {
            $project: {
              _id: 1,
              status: 1,
              confirmDate: 1,
              notes: 1,
              requestedAt: 1,
              priority: 1,
              items: 1,
              invetory: 1,
              createdAt: 1,
              pickUpDate: 1,
            },
          },
        ])
        .toArray();

      const formattedRequests = requests.map((request) => {
        const items = request.items.map((item) => {
          const matchedItem = request.invetory.find(
            (invItem) => invItem._id === item.itemId
          );
          return {
            ...item,
            name: matchedItem ? matchedItem.name : "Unknown Item",
            unit: matchedItem ? matchedItem.unit : "Unknown Unit",
            category: matchedItem ? matchedItem.category : "Unknown Category",
          };
        });
        return {
          ...request,
          items,
        };
      });
      reply.send({ requests: formattedRequests });
    } catch (error) {
      console.error("Error in fetching camp donation requests:", error);
      reply.status(500).send({ message: error.message });
    }
  });

  done();
};
export default donationRoute;
