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
      const {
        disasterId,
        items,
        campId,
        pickUpDate,
        notes,
        priority,
        _id,
        uid,
        status,
      } = req.body;
      if (!disasterId || !items || !campId || !pickUpDate || !priority) {
        return reply.status(400).send({ message: "All fields are required" });
      }
      if (_id) {
        await fastify.mongo.db.collection("campRequests").updateOne(
          { _id, disasterId },
          {
            $set: {
              items,
              confirmDate: new Date(pickUpDate),
              notes,
              priority,
              updatedBy: uid,
              status,
            },
          }
        );
        return reply
          .status(200)
          .send({ message: "Donation request updated successfully" });
      }
      await fastify.mongo.db.collection("campRequests").insertOne({
        _id: customIdGenerator("CRQ"),
        disasterId,
        campId,
        requestedAt: new Date(),
        items,
        status: "pending",
        confirmDate: new Date(pickUpDate),
        notes,
        createdBy: uid,
        priority,
      });
      reply.status(200).send({ message: "Donation request sent successfully" });
    } catch (error) {
      console.error("Error in camp donation request:", error);
      reply.status(500).send({ message: error.message });
    }
  });
  fastify.get("/campDonationRequest", isCampAdmin, async (req, reply) => {
    try {
      const { disasterId, campId } = req.query;
      if (!disasterId || !campId) {
        return reply.status(400).send({ message: "All fields are required" });
      }
      const donation = await fastify.mongo.db
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
              items: {
                $map: {
                  input: "$items",
                  as: "item",
                  in: {
                    itemId: "$$item.itemId",
                    quantity: "$$item.quantity",
                    name: {
                      $arrayElemAt: [
                        {
                          $filter: {
                            input: "$invetory",
                            as: "inv",
                            cond: { $eq: ["$$inv._id", "$$item.itemId"] },
                          },
                        },
                        0,
                      ],
                    },
                  },
                },
              },
            },
          },
        ])
        .toArray();
      reply.send(donation);
    } catch (error) {
      console.error("Error in fetching camp donation requests:", error);
      reply.status(500).send({ message: error.message });
    }
  });

  fastify.get("/getArrivedItems", async (req, reply) => {
    try {
      const { disasterId } = req.query;
      if (!disasterId) {
        return reply.status(400).send({ message: "disasterId is required" });
      }
      const user = await authenticatedUser(fastify, req, reply);
      if (!user) {
        return reply.status(401).send({ message: "Unauthorized" });
      }

      const assignPlace = user.roles.find(
        (role) => disasterId == role.disasterId
      )?.assignPlace;

      if (!assignPlace) {
        return reply
          .status(400)
          .send({ message: "You are not assigned to this disaster" });
      }

      const [incomming, outgoing, items] = await Promise.all([
        await fastify.mongo.db
          .collection("generalDonation")
          .find({ disasterId, status: "arrived" })
          .toArray(),
        await fastify.mongo.db
          .collection("campRequests")
          .find({ disasterId, status: "arrived" })
          .toArray(),
        await fastify.mongo.db
          .collection("inventory")
          .find({ disasterId })
          .toArray(),
      ]);
      const enrichItems = (data, itemType) => {
        return data.map((itemGroup) => {
          const updatedItems = itemGroup[itemType].map((item) => {
            const itemDetails = items.find(
              (i) => i._id.toString() === item.itemId.toString()
            );
            return {
              ...item,
              name: itemDetails?.name || "",
              category: itemDetails?.category || "",
              unit: itemDetails?.unit || "",
              room: itemDetails?.room || "",
            };
          });
          return { ...itemGroup, [itemType]: updatedItems };
        });
      };

      const incommings = enrichItems(incomming, "donatedItems");
      const outgoings = enrichItems(outgoing, "items");

      reply.send({ incomingItems: incommings, outgoingItems: outgoings });
    } catch (error) {
      reply.status(500).send({ message: error.message });
    }
  });

  fastify.get("/getMyContributions", async (req, reply) => {
    try {
      const { disasterId } = req.query;
      if (!disasterId) {
        return reply.status(400).send({ message: "disasterId is required" });
      }
      const user = await authenticatedUser(fastify, req, reply);
      if (!user) {
        return reply.status(401).send({ message: "Unauthorized" });
      }
      const uid = user._id;
      const assignPlace = user.roles.find(
        (role) => disasterId == role.disasterId
      )?.assignPlace;

      if (!assignPlace) {
        return reply
          .status(400)
          .send({ message: "You are not assigned to this disaster" });
      }

      const [incoming, outgoing] = await Promise.all([
        await fastify.mongo.db
          .collection("generalDonations")
          .find({ disasterId, volunteerId: uid, status: "processed" })
          .toArray(),
        await fastify.mongo.db
          .collection("campRequest")
          .find({ disasterId, volunteerId: uid, status: "processed" })
          .toArray(),
      ]);

      reply.send({ MyContributions: [...incoming, ...outgoing] });
    } catch (error) {
      reply.status(500).send({ message: error.message });
    }
  });

  fastify.post("/takeResponsibility", async (req, reply) => {
    try {
      const { disasterId, type } = req.body;
      if (!disasterId || !type) {
        return reply.status(400).send({ message: "all feilds is required" });
      }
      const user = await authenticatedUser(fastify, req, reply);

      if (!user) {
        return reply.status(401).send({ message: "Unauthorized" });
      }
      const assignPlace = user.roles.find(
        (role) => disasterId == role.disasterId
      )?.assignPlace;

      if (!assignPlace) {
        return reply
          .status(400)
          .send({ message: "You are not assigned to this disaster" });
      }

      const collection =
        type === "incoming" ? "generalDonation" : "campRequests";

      await fastify.mongo.db
        .collection(collection)
        .updateOne(
          { disasterId, status: "arrived" },
          { $set: { volunteerId: user._id } }
        );

      reply.send({ message: "Responsibility taken successfully" });
    } catch (error) {
      reply.status(500).send({ message: error.message });
    }
  });

  fastify.post("/dispatchDonation", async (req, reply) => {
    try {
      const { disasterId, processId, type } = req.body;
      if (!disasterId || !processId || !type) {
        return reply.status(400).send({ message: "all feilds is required" });
      }
      const user = await authenticatedUser(fastify, req, reply);

      if (!user) {
        return reply.status(401).send({ message: "Unauthorized" });
      }
      const assignPlace = user.roles.find(
        (role) => disasterId == role.disasterId
      )?.assignPlace;

      if (!assignPlace) {
        return reply
          .status(400)
          .send({ message: "You are not assigned to this disaster" });
      }

      const collection =
        type === "incoming" ? "generalDonation" : "campRequests";

      const process = await fastify.mongo.db
        .collection(collection)
        .findOne({ disasterId, _id: processId });
      if (!process) {
        return reply.status(404).send({ message: "Donation not found" });
      }

      await fastify.mongo.db
        .collection(collection)
        .updateOne(
          { disasterId, _id: processId },
          { $set: { status: "processed", processedAt: new Date() } }
        );

      const inventoryItems = process.donatedItems.map((item) => ({
        itemId: item.itemId,
        quantity: item.quantity,
      }));

      await fastify.mongo.db
        .collection("inventory")
        .updateMany(
          {
            disasterId,
            _id: { $in: inventoryItems.map((item) => item.itemId) },
          },
          {
            $inc: {
              quantity: inventoryItems.find((i) => i.itemId === item._id)
                .quantity,
            },
          }
        );

      try {
        await mailSender.sendDonationDispatchMail(process.donarEmail, {
          donationItems: process.donatedItems,
          donarName: process.donarName,
          donarEmail: process.donarEmail,
          donarAddress: process.donarAddress,
          status: "processed",
          disasterId,
          donarPhone: process.donarPhone || "",
          deleverdAt: new Date(),
        });
      } catch (error) {
        console.log("Error sending donation dispatch email:", error);
      }

      reply.send({ message: "Donation dispatched successfully" });
    } catch (error) {
      reply.status(500).send({ message: error.message });
    }
  });

  fastify

  done();
};
export default donationRoute;
