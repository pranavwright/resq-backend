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
        .collection("point_inventory")
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
      const { disasterId, uid } = req.query;
      const cp = await fastify.mongo.db.collection("collectionPoints").aggregate([
        {
          $match: {
            collectionAdmin: uid,
            status: "active",
            disasterId
          }
        },
        {
          $lookup: {
            from: "point_inventory",
            localField: "_id",
            foreignField: "collectionPointId",
            as: "inventory_docs", // Renamed for clarity
          },
        },

        {
          $unwind: {
            path: '$inventory_docs',
            preserveNullAndEmptyArrays: true
          }
        },

        {
          $lookup: {
            from: "catalog_items",
            localField: "inventory_docs.itemId",
            foreignField: "_id",
            as: "item_details",
          },
        },

        {
          $unwind: {
            path: "$item_details",
            preserveNullAndEmptyArrays: true
          }
        },

        {
          $group: {
            _id: "$_id", // Group by Collection Point ID
            name: { $first: "$name" },
            location: { $first: "$location" },
            contact: { $first: "$contact" },
            point_inventory: {
              $push: {
                $cond: [
                  { $ifNull: ["$inventory_docs", false] },
                  {
                    _id: "$inventory_docs._id",
                    itemId: "$inventory_docs.itemId",
                    quantity: "$inventory_docs.quantity",
                    room: "$inventory_docs.room",
                    name: "$item_details.name",
                    description: "$item_details.description",
                    category: "$item_details.category",
                    unit: "$item_details.unit"
                  },
                  "$$REMOVE"
                ]
              }
            }
          }
        }
      ]).toArray();

      reply.send({ list: cp });
    } catch (error) {
      reply.status(500).send({ message: error.message });
    }
  });
  fastify.post("/updateItemLocation", isDonationAdmin, async (req, reply) => {
    try {
      const { itemId, room, disasterId, uid, stockTd } = req.body;
      if (!itemId || !room || !disasterId) {
        return reply.status(400).send({ message: "All fields are required" });
      }

      await fastify.mongo.db
        .collection("point_inventory")
        .updateOne({ itemId, disasterId, _id: stockTd }, { $set: { room } });
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
                from: "catalog_items",
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

  // Haversine formula to calculate distance
  const getDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

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
        locationMap, // { lat, lng }
      } = req.body;

      if (
        !donarName ||
        !donarEmail ||
        !items ||
        !Array.isArray(items) ||
        items.length === 0 ||
        !disasterId
      ) {
        return reply.status(400).send({ message: "All fields are required" });
      }

      // 1. Find Nearest Collection Point logic (MongoDB Geospatial)
      let nearbyCollectionPoint = null;
      if (locationMap && locationMap.lat && locationMap.lng) {
        try {
          const nearest = await fastify.mongo.db.collection("collectionPoints").findOne({
            disasterId,
            status: 'active',
            geoLocation: {
              $near: {
                $geometry: { type: "Point", coordinates: [parseFloat(locationMap.lng), parseFloat(locationMap.lat)] }
                // Optional: $maxDistance: 50000 // 50km
              }
            }
          });
          nearbyCollectionPoint = nearest;
        } catch (err) {
          console.error("Geospatial Query Error:", err);
          // Fallback or ignore if index missing (index creation is auto in postCollectionPoint now)
        }
      }

      let donatedItems = [];
      let newItemIds = [];

      for (const item of items) {
        let itemIdToUse = item.itemId;
        if (!item.itemId) {
          // New Item Logic - Strict Validation on Category and Unit
          const allowedCategories = ["Food", "Medicine", "Grocery", "Machinery", "Stationery", "Clothing", "Other"];
          const allowedUnits = ["kg", "g", "liter", "ml", "unit", "box", "packet", "sqft", "meter"];

          if (!allowedCategories.includes(item.category)) {
            return reply.status(400).send({ message: `Invalid category: ${item.category}. Allowed: ${allowedCategories.join(", ")}` });
          }
          if (!allowedUnits.includes(item.unit)) {
            return reply.status(400).send({ message: `Invalid unit: ${item.unit}. Allowed: ${allowedUnits.join(", ")}` });
          }

          let newItem = await fastify.mongo.db
            .collection("catalog_items")
            .findOne({
              name: item.name,
              category: item.category,
              unit: item.unit,
              disasterId,
            });

          if (newItem) {
            itemIdToUse = newItem._id;
            newItemIds.push(itemIdToUse);
            continue;
          }

          newItem = await fastify.mongo.db
            .collection("catalog_items")
            .insertOne({
              _id: customIdGenerator("ITM"),
              name: item.name,
              description: item.description,
              category: item.category,
              unit: item.unit,
              disasterId,
              createdAt: new Date()
            });
          await fastify.mongo.db.collection("point_inventory").insertOne({
            _id: customIdGenerator('STK'),
            itemId: newItem.insertedId,
            quantity: 0,
            disasterId,
            collectionPointId: nearbyCollectionPoint._id,
            updatedAt: new Date()
          })
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
        locationMap: locationMap || null,
        assignedCollectionPointId: nearbyCollectionPoint ? nearbyCollectionPoint._id : null,
      });

      // Fetch all items that were part of the donation for the email
      const allDonatedItemIds = donatedItems.map((item) => item.itemId);
      const donationItemsForEmail = await fastify.mongo.db
        .collection("catalog_items")
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
          collectionPoint: nearbyCollectionPoint ? {
            name: nearbyCollectionPoint.name,
            contact: nearbyCollectionPoint.contact,
            location: nearbyCollectionPoint.location || nearbyCollectionPoint.address
          } : null
        });
        console.log(`Donation request email sent to ${donarEmail}`);
      } catch (emailError) {
        console.error("Error sending donation request email:", emailError);
        // Note: we continue even if email fails
      }

      reply.status(200).send({
        message: "Donation added successfully",
        nearestCollectionPoint: nearbyCollectionPoint ? {
          name: nearbyCollectionPoint.name,
          location: nearbyCollectionPoint.location || nearbyCollectionPoint.address,
          locationMap: nearbyCollectionPoint.locationMap,
          contact: nearbyCollectionPoint.contact
        } : null
      });
    } catch (error) {
      console.error("Error processing donation:", error);
      reply.status(500).send({ message: error.message });
    }
  });

  fastify.post("/updateDonation", isDonationAdmin, async (req, reply) => {
    try {
      const { donationId, status, disasterId, confirmDate, con } = req.body;
      if (!donationId || !status) {
        return reply.status(400).send({ message: "All fields are required" });
      }

      const { value: donation } = await fastify.mongo.db.collection("generalDonation").findOneAndUpdate(
        { _id: donationId, disasterId },
        {
          $set: {
            status,
            ...(status == "arrived" && { arrivedAt: new Date() }),
            ...(confirmDate && { confirmDate: new Date(confirmDate) }),
            ...(status === "processed" && { processedAt: new Date() }),
          },
        },
        {
          returnDocument: "after"
        }
      );
      if (!donation) {
        return reply.status(404).send({ message: "Donation not found" });
      }
      const donationItemsForEmail = await fastify.mongo.db
        .collection("catalog_items")
        .find({
          _id: { $in: donation.donatedItems.map((item) => item.itemId) },
        })
        .toArray();

      if (status == "confirm") {
        try {
          // Fetch Assigned Collection Point Details
          let collectionPointDetails = null;
          if (donation.assignedCollectionPointId) {
            collectionPointDetails = await fastify.mongo.db.collection("collectionPoints").findOne({
              _id: donation.assignedCollectionPointId
            });
          }

          await mailSender.sendDonationConfomationMail(donation.donarEmail, {
            donationItems: donationItemsForEmail.map(item => ({
              name: item.name,
              unit: item.unit,
              category: item.category,
              quantity: donation.donatedItems.find(d => d.itemId.toString() === item._id.toString())?.quantity || 0
            })),
            donarName: donation.donarName,
            donarEmail: donation.donarEmail,
            donarAddress: donation.donarAddress,
            status,
            disasterId,
            donarPhone: donation.donarPhone || "",
            estimate: confirmDate ? new Date(confirmDate) : new Date(),
            collectionPoint: collectionPointDetails // Pass CP details
          });
        } catch (error) {
          console.error("Error sending donation request email:", error);
          return reply.status(200).send({
            message: "Donation added successfully but mail did't send",
          });
        }
      } else if (status === "arrived") {
        if (donation.assignedCollectionPointId) {
          const roomId = `cp_${donation.assignedCollectionPointId}`;

          // Emit event to room
          if (fastify.io) {
            const publicDonationData = {
              _id: donation._id,
              items: donationItemsForEmail.map(item => ({
                _id: item._id,
                name: item.name,
                unit: item.unit,
                category: item.category,
                quantity: donation.donatedItems.find(d => d.itemId.toString() === item._id.toString())?.quantity || 0,
                fulfilled: false
              })),
              donarName: donation.donarName,
              status: 'arrived'
            };
            fastify.io.to(roomId).emit("donation_arrived", publicDonationData);
          }
        }
      } else if (status == "processed") {
        // processed logic is now handled in /processDonation, but keeping fallback just in case
      }

      reply.status(200).send({ message: "Donation status updated" });
    } catch (error) {
      reply.status(500).send({ message: error.message });
    }
  });

  const isVolunteer = {
    preHandler: [
      (req, reply) => isUserAllowed(fastify, req, reply, ["collectionPointVolunteer", "collectionPointAdmin"])
    ]
  };

  fastify.post("/takeCharge", isVolunteer, async (req, reply) => {
    try {
      const { donationId, volunteerId, disasterId, type } = req.body;
      const collectionName = type === 'campRequest' ? 'campRequests' : 'generalDonation';

      // Validate
      const donation = await fastify.mongo.db.collection(collectionName).findOne({ _id: donationId, disasterId });
      if (!donation) return reply.status(404).send({ message: "Request not found" });
      if (donation.status !== 'arrived') return reply.status(400).send({ message: "Request is not in 'arrived' status" });
      if (donation.volunteerId) return reply.status(400).send({ message: "Request is already being processed by someone" });

      await fastify.mongo.db.collection(collectionName).updateOne(
        { _id: donationId },
        { $set: { status: 'sorting', volunteerId, startedSortingAt: new Date() } }
      );

      if (fastify.io && donation.assignedCollectionPointId) {
        const roomId = `cp_${donation.assignedCollectionPointId}`;
        fastify.io.to(roomId).emit("donation_taken", { donationId, volunteerId });
      }

      reply.send({ message: "You have taken charge", donationId });
    } catch (error) {
      reply.status(500).send({ message: error.message });
    }
  });

  fastify.post("/processDonation", isVolunteer, async (req, reply) => {
    try {
      const { donationId, items, disasterId, type } = req.body; // items: [{ itemId, quantity, ... }]
      const collectionName = type === 'campRequest' ? 'campRequests' : 'generalDonation';

      const donation = await fastify.mongo.db.collection(collectionName).findOne({ _id: donationId, disasterId });
      if (!donation) return reply.status(404).send({ message: "Request not found" });

      // Update Inventory
      if (donation.assignedCollectionPointId) {
        for (const item of items) { // Process verified items
          // If campRequest (outgoing), we DECREMENT inventory. If general (incoming), we INCREMENT.
          const quantityChange = type === 'campRequest' ? -Math.abs(parseInt(item.quantity)) : Math.abs(parseInt(item.quantity));

          await fastify.mongo.db.collection("point_inventory").updateOne(
            { itemId: item.itemId || item._id, collectionPointId: donation.assignedCollectionPointId, disasterId },
            { $inc: { quantity: quantityChange }, $set: { updatedAt: new Date() } },
            { upsert: true }
          );
        }
      }

      // Update Status
      await fastify.mongo.db.collection(collectionName).updateOne(
        { _id: donationId },
        { $set: { status: 'processed', processedAt: new Date(), processedItems: items } }
      );

      if (fastify.io && donation.assignedCollectionPointId) {
        const roomId = `cp_${donation.assignedCollectionPointId}`;
        fastify.io.to(roomId).emit("donation_processed", { donationId });
      }

      // Send Email (Async) - Only for General Donations for now
      if (type !== 'campRequest') {
        const donationItemsForEmail = await fastify.mongo.db
          .collection("catalog_items")
          .find({ _id: { $in: donation.donatedItems.map((item) => item.itemId) } })
          .toArray();

        try {
          await mailSender.sendDonationDispatchMail(donation.donarEmail, {
            donationItems: donationItemsForEmail,
            donarName: donation.donarName,
            donarEmail: donation.donarEmail,
            donarAddress: donation.donarAddress,
            status: 'processed',
            disasterId,
            donarPhone: donation.donarPhone || "",
            deleverdAt: new Date(),
          });
        } catch (e) { console.error("Email error", e); }
      }

      reply.send({ message: "Processed successfully" });

    } catch (error) {
      reply.status(500).send({ message: error.message });
    }
  });

  fastify.get('/getArrivedGeneralDonation', isVolunteer, async (req, reply) => {
    try {
      const { uid, disasterId } = req.query;

      // 1. Find the user and their assigned place for this specific disaster
      const user = await fastify.mongo.db.collection("users").findOne(
        { _id: uid },
        { projection: { roles: 1 } }
      );

      const assignedPlace = user?.roles?.find(
        role => role.disasterId === disasterId && role.assignPlace
      )?.assignPlace;

      if (!assignedPlace) {
        return reply.status(404).send({ message: "No assigned collection point found for this volunteer." });
      }

      // 2. Fetch donations arrived at that specific collection point
      const donations = await fastify.mongo.db.collection("generalDonation")
        .find({
          assignedCollectionPointId: assignedPlace,
          status: "arrived"
        }, {
          projection: {
            _id: 1, donarName: 1, donarEmail: 1, donarAddress: 1, donatedItems: 1, status: 1, donatedAt: 1, donarPhone: 1
          }
        })
        .toArray();
      const assigned = await fastify.mongo.db.collection("generalDonation")
        .find({
          assignedCollectionPointId: assignedPlace,
          status: "sorting",
          volunteerId: uid
        }, {
          projection: { _id: 1, donarName: 1, donarEmail: 1, donarAddress: 1, donatedItems: 1, status: 1, donatedAt: 1 }
        })
        .toArray();



      // 3. Fetch arrived Camp Requests for this CP
      const campRequests = await fastify.mongo.db.collection("campRequests")
        .find({
          assignedCollectionPointId: assignedPlace,
          status: "arrived",
          disasterId
        }, {
          projection: {
            _id: 1, items: 1, status: 1, arrivedAt: 1, campId: 1
          }
        })
        .toArray();

      // Enrich camp requests with Camp Name
      for (const req of campRequests) {
        const camp = await fastify.mongo.db.collection('camps').findOne({ _id: req.campId }, { projection: { name: 1 } });
        req.donarName = `Camp: ${camp?.name || 'Unknown'}`;
        req.donatedItems = req.items; // Normalize structure for frontend
        req.donatedAt = req.arrivedAt;
        req.type = 'campRequest';
      }

      const assignedCampRequests = await fastify.mongo.db.collection("campRequests")
        .find({
          assignedCollectionPointId: assignedPlace,
          status: "sorting",
          volunteerId: uid,
          disasterId
        })
        .toArray();

      for (const req of assignedCampRequests) {
        const camp = await fastify.mongo.db.collection('camps').findOne({ _id: req.campId }, { projection: { name: 1 } });
        req.donarName = `Camp: ${camp?.name || 'Unknown'}`;
        req.donatedItems = req.items;
        req.donatedAt = req.arrivedAt;
        req.type = 'campRequest';
      }

      // Normalize general donations type
      donations.forEach(d => {
        d.type = 'general';
        // Ensure donatedItems exists to avoid errors later
        if (!d.donatedItems) d.donatedItems = [];
      });
      assigned.forEach(d => {
        d.type = 'general';
        if (!d.donatedItems) d.donatedItems = [];
      });

      // 4. Extract unique Item IDs (Flattening the array)
      const allItems = [
        ...donations.flatMap(d => d.donatedItems?.map(i => i.itemId) || []),
        ...campRequests.flatMap(d => d.donatedItems?.map(i => i.itemId) || []),
        ...assigned.flatMap(d => d.donatedItems?.map(i => i.itemId) || []),
        ...assignedCampRequests.flatMap(d => d.donatedItems?.map(i => i.itemId) || [])
      ];
      const uniqueItemIds = [...new Set(allItems)];

      // 4. Fetch catalog details for all items in one query
      const itemsCatalog = await fastify.mongo.db.collection("catalog_items")
        .find({ _id: { $in: uniqueItemIds } })
        .toArray();

      // Helper to enrich logic
      const enrich = (list) => list.map(d => ({
        ...d,
        donatedItems: d.donatedItems?.map(i => {
          let found = itemsCatalog.find(cat => cat._id.toString() === i.itemId.toString());
          if (!found && i.name) {
            return i;
          }
          return {
            ...i,
            name: found?.name || i.name,
            unit: found?.unit || i.unit,
            category: found?.category,
            description: found?.description
          }
        })
      }));



      const enrichedDonations = enrich([...donations, ...campRequests]);
      const enrichedAssigned = enrich([...assigned, ...assignedCampRequests]);

      reply.send({ donations: enrichedDonations, assigned: enrichedAssigned[0] || null });
    } catch (error) {
      fastify.log.error(error);
      reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  fastify.get("/getGeneralDonation", isDonationAdmin, async (req, reply) => {
    try {
      const { uid, disasterId } = req.query
      const cp = await fastify.mongo.db.collection("collectionPoints").find({ collectionAdmin: uid, status: "active", disasterId }, { projection: { _id: 1, name: 1, location: 1, contact: 1 } }).toArray()
      let list = []
      let itemids = []
      for (const c of cp) {

        const donation = await fastify.mongo.db
          .collection("generalDonation")
          .find(
            { disasterId: req.query.disasterId, assignedCollectionPointId: c._id },
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
          ).toArray()
        donation?.forEach(d => d?.donatedItems?.forEach((item) => {
          itemids.push(item.itemId)
        }))
        if (donation) {
          c.donation = donation
          list.push(c)
        }
      }

      const items = await fastify.mongo.db.collection("catalog_items").find({ _id: { $in: itemids } }).toArray()
      list?.forEach(cp => cp?.donation?.forEach(d => d?.donatedItems?.forEach((item) => {
        let currentTtem = items.find((i) => i?._id?.toString() === item.itemId?.toString())
        item.name = currentTtem?.name
        item.unit = currentTtem?.unit
        item.category = currentTtem?.category
      })))
      reply.send(list);
    } catch (error) {
      reply.status(500).send({ message: error.message });
    }
  });

  fastify.get("/getCampRequests", isCampAdmin, async (req, reply) => {
    try {
      const { campId, disasterId } = req.query;
      const list = await fastify.mongo.db.collection("campRequests")
        .find({ campId, disasterId })
        .sort({ requestedAt: -1 })
        .toArray();
      reply.send({ list });
    } catch (error) {
      reply.status(500).send({ message: error.message });
    }
  });

  fastify.get(
    "/allCampRequest",
    isDonationAdmin,
    async (req, reply) => {
      try {
        const { disasterId } = req.query;
        const { uid } = req.query
        const collectionPoints = await fastify.mongo.db.collection('collectionPoints').find({ disasterId, collectionAdmin: uid }, { projection: { _id: 1, name: 1, location: 1, collectionAdmin: 1 } }).toArray()
        let list = await fastify.mongo.db.collection('camps').aggregate([
          {
            $match: {
              disasterId: disasterId,
              status: "active"
            },
          },
          {
            // 1. Join with campRequests
            $lookup: {
              from: "campRequests",
              localField: "_id",
              foreignField: "campId",
              as: "requests"
            }
          },
          {
            // 2. Join with catalog_items to get all possible item details
            $lookup: {
              from: "catalog_items",
              localField: "requests.items.itemId",
              foreignField: "_id",
              as: "catalog_data"
            }
          },
          {
            // 3. Map through requests and their nested items to merge the data
            $addFields: {
              requests: {
                $map: {
                  input: "$requests",
                  as: "req",
                  in: {
                    $mergeObjects: [
                      "$$req",
                      {
                        items: {
                          $map: {
                            input: "$$req.items",
                            as: "item",
                            in: {
                              $mergeObjects: [
                                "$$item",
                                {
                                  // Find the matching item from the catalog_data array
                                  $arrayElemAt: [
                                    {
                                      $filter: {
                                        input: "$catalog_data",
                                        as: "cat",
                                        cond: { $eq: ["$$cat._id", "$$item.itemId"] }
                                      }
                                    },
                                    0
                                  ]
                                }
                              ]
                            }
                          }
                        }
                      }
                    ]
                  }
                }
              }
            }
          },
          {
            $project: { catalog_data: 0 }
          }
        ]).toArray();

        list = list.map((camp) => {
          camp.requests = camp.requests.filter((request) => request.status === "pending" || collectionPoints.find((cp) => cp._id?.toString() === request.assignedCollectionPointId?.toString()))
          return camp
        })


        reply.send({ list, collectionPoints });
      } catch (error) {
        reply.status(500).send({ message: error.message });
      }
    }
  );

  fastify.post('/campRequestStatus', isDonationAdmin, async (req, reply) => {
    try {
      const {
        disasterId,
        items,
        campId,
        pickUpDate,
        _id,
        uid,
        status,
        collectionPointId
      } = req.body;

      if (!_id) {
        return reply.status(400).send({ message: "_id is required" })
      }
      if (status == 'arrived') {
        const arrivalDate = new Date();
        await fastify.mongo.db.collection("campRequests").updateOne(
          { _id, disasterId },
          {
            $set: {
              status,
              arrivedAt: arrivalDate
            },
          }
        );


        // Fetch Data for Socket
        const request = await fastify.mongo.db.collection("campRequests").findOne({ _id });
        if (request && request.assignedCollectionPointId) {
          const camp = await fastify.mongo.db.collection('camps').findOne({ _id: request.campId });
          // Enrich items quickly if needed or send raw. 
          // Frontend expects { _id, donarName, donatedItems, status, donatedAt }

          // Fetch Item Names
          const itemIds = request.items.map(i => i.itemId);
          const catalog = await fastify.mongo.db.collection('catalog_items').find({ _id: { $in: itemIds } }, { projection: { name: 1, unit: 1 } }).toArray();

          const enrichedItems = request.items.map(i => {
            const cat = catalog.find(c => c._id.toString() == i.itemId.toString());
            return { ...i, name: cat?.name, unit: cat?.unit };
          });

          const socketPayload = {
            _id: request._id,
            donarName: `Camp: ${camp?.name || 'Unknown'}`,
            donatedItems: enrichedItems,
            status: 'arrived',
            donatedAt: arrivalDate,
            type: 'campRequest'
          };

          const roomId = `cp_${request.assignedCollectionPointId}`;
          fastify.io.to(roomId).emit('donation_arrived', socketPayload);
        }
        return reply
          .status(200)
          .send({ message: "Donation request updated successfully" });
      }
      if (!disasterId || !items || !campId || !pickUpDate) {
        return reply.status(400).send({ message: "All fields are required" });
      }
      await fastify.mongo.db.collection("campRequests").updateOne(
        { _id, disasterId, campId },
        {
          $set: {
            items,
            confirmDate: new Date(pickUpDate),
            updatedBy: uid,
            status,
            assignedCollectionPointId: collectionPointId
          },
        }
      );
      return reply
        .status(200)
        .send({ message: "Donation request updated successfully" });
    } catch (error) {

    }
  })

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
          .collection("point_inventory")
          // This aggregates all point_inventory for the disaster, effectively checking global stock
          // or at least available stock in the system for this disaster.
          .aggregate([
            { $match: { disasterId, itemId: itemIdToCheck } },
            { $group: { _id: null, total: { $sum: "$quantity" } } }
          ]).toArray();

        const availableInCurrentCamp = (currentCampInventory[0]?.total) || 0;

        // Fetch pending/approved camp requests from other camps for this item
        const otherCampRequests = await fastify.mongo.db
          .collection("campRequests")
          .find({
            disasterId,
            status: { $in: ["confirmed", "arrived"] },
            "donatedItems.itemId": itemIdToCheck,
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
                status: { $nin: ["cancelled", "processed", 'pending'] },
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

  fastify.post('/checkCollectionPointsAvailability', isDonationAdmin, async (req, reply) => {
    try {
      const { disasterId, items, collectionPointIds } = req.body;
      if (!disasterId || !items || !collectionPointIds) {
        return reply.status(400).send({ message: "Missing required fields" });
      }

      const itemIds = items.map(i => i.itemId);
      const inventory = await fastify.mongo.db.collection('point_inventory').find({
        disasterId,
        collectionPointId: { $in: collectionPointIds },
        itemId: { $in: itemIds }
      }).toArray();

      const donations = await fastify.mongo.db.collection("generalDonation")
        .find(
          {
            disasterId,
            assignedCollectionPointId: { $in: collectionPointIds },
            "donatedItems.itemId": { $in: itemIds },
            status: { $nin: ["cancelled", "processed", 'pending'] },
          },
          { projection: { collectionPointId: '$assignedCollectionPointId', donatedItems: 1, status: 1, confirmDate: 1 } }
        )
        .toArray();

      const results = collectionPointIds.map(cpId => {
        let allAvailable = true;
        let availableCount = 0;
        let maxDate = null;

        items.forEach(reqItem => {
          // 1. Check Physical Inventory
          const stockItem = inventory.find(inv =>
            inv.collectionPointId === cpId &&
            (inv.itemId === reqItem.itemId || inv.itemId.toString() === reqItem.itemId.toString())
          );
          let currentQty = stockItem ? stockItem.quantity : 0;

          if (currentQty >= reqItem.quantity) {
            availableCount++;
            return; // Fully available from stock
          }

          // 2. Check Confirmed Donations
          const needed = reqItem.quantity - currentQty;

          // Get relevant donations for this CP and Item
          const relevantDonations = donations.filter(d =>
            d.collectionPointId === cpId &&
            d.donatedItems.some(di => di.itemId === reqItem.itemId || di.itemId.toString() === reqItem.itemId.toString())
          );

          let incomingQty = 0;
          let latestDonationDate = null;

          for (const don of relevantDonations) {
            const dItem = don.donatedItems.find(di => di.itemId === reqItem.itemId || di.itemId.toString() === reqItem.itemId.toString());
            if (dItem) {
              incomingQty += dItem.quantity;
              // Track the latest date needed to fulfill the order
              if (incomingQty <= needed || (incomingQty - dItem.quantity < needed)) {
                // If we are using this donation to fulfill the need, consider its date
                if (!latestDonationDate || new Date(don.confirmDate) > new Date(latestDonationDate)) {
                  latestDonationDate = don.confirmDate;
                }
              }
            }
          }

          if ((currentQty + incomingQty) >= reqItem.quantity) {
            availableCount++;
            // Update the overall maxDate for the whole request if this item pushes it further
            if (latestDonationDate) {
              if (!maxDate || new Date(latestDonationDate) > new Date(maxDate)) {
                maxDate = latestDonationDate;
              }
            }
          } else {
            allAvailable = false;
          }
        });

        return {
          cpId,
          allAvailable,
          availableCount,
          totalItems: items.length,
          availableDate: maxDate
        };
      });

      reply.send({ results });
    } catch (error) {
      reply.status(500).send({ message: error.message });
    }
  });

  fastify.post("/campRequest", isCampAdmin, async (req, reply) => {
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

  fastify.get("/campRequest", isCampAdmin, async (req, reply) => {
    try {
      const { disasterId, uid } = req.query;

      if (!disasterId || !uid) {
        return reply.status(400).send({ message: "Disaster ID and User ID are required" });
      }

      const list = await fastify.mongo.db.collection("camps").aggregate([
        {
          // 1. Find all camps owned by this Admin
          $match: { campAdmin: uid }
        },
        {
          // 2. Join with campRequests specifically for this disaster
          $lookup: {
            from: "campRequests",
            let: { camp_id: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$campId", "$$camp_id"] },
                      { $eq: ["$disasterId", disasterId] }
                    ]
                  }
                }
              },
              {
                // 3. Join items within the request to the catalog
                $lookup: {
                  from: "catalog_items",
                  localField: "items.itemId",
                  foreignField: "_id",
                  as: "catalog_data"
                }
              },
              {
                // 4. Map the catalog data into the items array
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
                      as: "it",
                      in: {
                        $mergeObjects: [
                          {
                            $arrayElemAt: [
                              {
                                $filter: {
                                  input: "$catalog_data",
                                  as: "cat",
                                  cond: { $eq: ["$$cat._id", "$$it.itemId"] }
                                }
                              },
                              0
                            ]
                          },
                          { itemId: "$$it.itemId", quantity: "$$it.quantity" }
                        ]
                      }
                    }
                  }
                }
              }
            ],
            as: "requests"
          }
        }
      ]).toArray();

      reply.send({ list });
    } catch (error) {
      fastify.log.error(error);
      reply.status(500).send({ message: "Internal Server Error" });
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
          .collection("catalog_items")
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

      reply.send({ incomingItems: incommings, outgoingItems: outgoings, userId: user._id });
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

  fastify.post("/dispatchDonation", {
    preHandler: [
      (req, reply) =>
        isUserAllowed(fastify, req, reply, ["collectionPointAdmin", 'campAdmin']),
    ],
  }, async (req, reply) => {
    try {
      const { disasterId, processId, type } = req.body;
      if (!disasterId || !processId || !type) {
        return reply.status(400).send({ message: "all feilds is required" });
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



      // REPLACEMENT implementation:
      // We need to handle this manually since updateMany on different items with specific increments is tricky without bulkWrite.
      // And we need collectionPointId.

      let targetCpId = null;
      if (type === "incoming") {
        targetCpId = process.assignedCollectionPointId;
      } else {
        // Outgoing Camp Request
        // The user dispatching this is the CP Admin. Use their assigned CP.
        targetCpId = assignPlace;
      }

      if (type === "incoming" && targetCpId) {
        for (const item of process.donatedItems) {
          await fastify.mongo.db.collection("point_inventory").updateOne(
            { itemId: item.itemId, collectionPointId: targetCpId, disasterId },
            { $inc: { quantity: parseInt(item.quantity) }, $set: { updatedAt: new Date() } },
            { upsert: true }
          );
        }
      } else if (type !== "incoming" && targetCpId) {
        // Outgoing: Deduct from inventory
        // 'process' is the campRequest, so we iterate 'items' (not donatedItems)
        for (const item of process.items) {
          await fastify.mongo.db.collection("point_inventory").updateOne(
            { itemId: item.itemId, collectionPointId: targetCpId, disasterId },
            { $inc: { quantity: -parseInt(item.quantity) }, $set: { updatedAt: new Date() } }
          );
        }
      }

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


  done();
};
export default donationRoute;
