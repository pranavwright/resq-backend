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

const disasterRoute = (fastify, options, done) => {
  const isAuthUser = {
    preHandler: [(req, reply) => authenticatedUser(fastify, req, reply)],
  };
  const isSuperAdmin = {
    preHandler: [
      (req, reply) => isUserAllowed(fastify, req, reply, ["superAdmin"]),
    ],
  };
  const isAdmin = {
    preHandler: [
      (req, reply) =>
        isUserAllowed(fastify, req, reply, ["superAdmin", "admin", "stat"]),
    ],
  };

  const slugify = (str) => {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
  };

  fastify.get("/getDisasterData", async (req, reply) => {
    try {
      const { disasterId, slug } = req.query;

      if (!disasterId && !slug) {
        return reply.status(400).send({ message: "Disaster ID or slug is required" });
      }

      const matchQuery = disasterId ? { _id: disasterId } : { slug: slug };

      const disasterData = await fastify.mongo.db
        .collection("disasters")
        .aggregate([
          {
            $match: matchQuery,
          },
          {
            $lookup: {
              from: "camps",
              localField: "_id",
              foreignField: "disasterId",
              as: "camps",
            },
          },
          {
            $lookup: {
              from: "collectionPoints",
              localField: "_id",
              foreignField: "disasterId",
              as: "collectionPoints",
            },
          },
          {
            $lookup: {
              from: "members",
              localField: "_id",
              foreignField: "disasterId",
              as: "members",
            },
          },
          {
            $lookup: {
              from: "catalog_items",
              localField: "_id",
              foreignField: "disasterId",
              as: "items",
            },
          },
          {
            $project: {
              _id: 1,
              name: 1,
              description: 1,
              location: 1,
              startDate: 1,
              endDate: 1,
              status: 1,
              state: 1,
              district: 1,
              severity: 1,
              type: 1,
              campsCount: { $size: "$camps" },
              collectionPointsCount: { $size: "$collectionPoints" },
              alive: {
                $size: {
                  $filter: {
                    input: "$members",
                    as: "member",
                    cond: { $eq: ["$$member.status", "alive"] },
                  },
                },
              },
              dead: {
                $size: {
                  $filter: {
                    input: "$members",
                    as: "member",
                    cond: { $eq: ["$$member.status", "dead"] },
                  },
                },
              },
              missing: {
                $size: {
                  $filter: {
                    input: "$members",
                    as: "member",
                    cond: { $eq: ["$$member.status", "missing"] },
                  },
                },
              },
              items: 1,
            },
          },
        ])
        .toArray();

      if (disasterData.length === 0) {
        return reply.status(404).send({ message: "Disaster not found" });
      }

      reply.send(disasterData[0]);
    } catch (error) {
      console.error("Error fetching disaster data:", error);
      reply.status(500).send({ message: "Internal Server Error" });
    }
  });
  fastify.post("/postDisaster", isSuperAdmin, async (req, reply) => {
    try {
      const {
        _id,
        name,
        slug,
        description,
        location,
        startDate = new Date(),
        endDate,
        status = "active",
        state,
        district,
        severity,
        donationStatus = "active",
        uid,
        type,
      } = req.body;
      if (_id) {
        await fastify.mongo.db.collection("disasters").updateOne(
          { _id },
          {
            $set: {
              ...(status && { status }),
              ...(name && { name }),
              ...(slug && { slug }),
              ...(description && { description }),
              ...(location && { location }),
              ...(severity && { severity }),
              ...(donationStatus && { donationStatus }),
              ...(location && { location }),
              ...(type & { type }),
              ...(status == "inactive" && { endDate: endDate ?? new Date() }),
              updatedBy: uid,
              updatedAt: new Date(),
            },
          }
        );
      } else {
        if (
          !name ||
          !description ||
          !location ||
          !startDate ||
          !state ||
          !district ||
          !severity ||
          !location ||
          !type
        ) {
          return reply.status(400).send({ message: "All fields are required" });
        }
        await fastify.mongo.db.collection("disasters").insertOne({
          _id: customIdGenerator("DIST"),
          name,
          slug: slug || slugify(name),
          description,
          location,
          startDate: new Date(startDate),
          status: "active",
          state,
          district,
          severity,
          donationStatus: "active",
          location,
          type,
          createdBy: uid,
          createdAt: new Date(),
        });
      }
      reply.status(200).send({ message: "Disaster created/updated" });
    } catch (error) {
      reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  fastify.get("/getDisasters", async (req, reply) => {
    try {
      const list = await fastify.mongo.db
        .collection("disasters")
        .find()
        .toArray();
      reply.send(list);
    } catch (error) {
      reply.status(500).sent({ message: "Internal Server Error" });
    }
  });

  // Helper to sync admin roles
  const syncAdminRole = async (disasterId, placeId, oldAdminId, newAdminId, roleName) => {
    // 1. Remove role from old admin
    if (oldAdminId && oldAdminId !== newAdminId) {
      await fastify.mongo.db.collection("users").updateOne(
        { _id: oldAdminId, "roles.disasterId": disasterId },
        {
          $pull: { "roles.$.roles": roleName },
          // Don't nullify assignPlace if they have other roles there? 
          // For simplicity, if they lose the admin role for this place, we assume they are no longer assigned there,
          // unless we want to keep them as a volunteer. 
          // Let's safe-guard: if they have no other roles for this place, remove assignPlace.
          // Actually, simplest is just unset assignPlace if it matches.
        }
      );
      // We might want to remove assignPlace cleanly but pulling from array is complex if structure varies.
      // Let's assume standard behavior: remove role. if roles array becomes empty or no longer has place-relevant roles, handle it.
      // For this MVP, we just pull the role.
    }

    // 2. Add role to new admin
    if (newAdminId) {
      // Check if user has disaster role
      const user = await fastify.mongo.db.collection("users").findOne({ _id: newAdminId });
      if (user) {
        const hasDisasterRole = user.roles?.find(r => r.disasterId === disasterId);
        if (hasDisasterRole) {
          await fastify.mongo.db.collection("users").updateOne(
            { _id: newAdminId, "roles.disasterId": disasterId },
            {
              $addToSet: { "roles.$.roles": roleName },
              $set: { "roles.$.assignPlace": placeId }
            }
          );
        } else {
          // Add new role block
          await fastify.mongo.db.collection("users").updateOne(
            { _id: newAdminId },
            {
              $push: {
                roles: {
                  disasterId,
                  roles: [roleName],
                  assignPlace: placeId
                }
              }
            }
          );
        }
      }
    }
  };

  fastify.post("/postCamp", isAdmin, async (req, reply) => {
    try {
      const {
        disasterId,
        location,
        contact,
        capacity,
        campAdmin, // This is the User ID of the admin
        _id,
        uid,
        name,
        status = "active",
        // New Fields
        nearbyHospital, // { exists: boolean, distance: number }
        nearbyHelipad,  // { exists: boolean, distance: number }
        friendliness,   // { oldAge: number, pregnant: number, child: number }
        locationMap,    // { lat: number, lng: number }
        address,        // Manual address string
      } = req.body;

      let campId = _id;
      let oldCampData = null;

      // Construct GeoJSON Point if locationMap is valid
      const geoLocation = (locationMap?.lat && locationMap?.lng)
        ? { type: "Point", coordinates: [parseFloat(locationMap.lng), parseFloat(locationMap.lat)] }
        : null;

      if (_id) {
        // Fetch old data to check for admin change
        oldCampData = await fastify.mongo.db.collection("camps").findOne({ _id, disasterId });
        campId = _id;

        await fastify.mongo.db.collection("camps").updateOne(
          { _id, disasterId },
          {
            $set: {
              ...(location && { location }),
              ...(contact && { contact }),
              ...(capacity && { capacity }),
              campAdmin, // Update the admin ID stored in Camp
              ...(name && { name }),
              ...(status && { status }),
              ...(geoLocation && { geoLocation }), // Save GeoJSON

              // New Fields Updates
              ...(nearbyHospital && { nearbyHospital }),
              ...(nearbyHelipad && { nearbyHelipad }),
              ...(friendliness && { friendliness }),
              ...(address && { address }),

              updatedAt: new Date(),
              updatedBy: uid,
            },
          }
        );
      } else {
        campId = customIdGenerator("CMPT");
        if (!name || !location) {
          return reply.status(400).send({ message: "All fields are required" });
        }
        await fastify.mongo.db.collection("camps").insertOne({
          _id: campId,
          disasterId,
          name,
          location,
          contact,
          capacity,
          campAdmin,
          status,

          // New Fields
          nearbyHospital: nearbyHospital || { exists: false, distance: 0 },
          nearbyHelipad: nearbyHelipad || { exists: false, distance: 0 },
          friendliness: friendliness || { oldAge: 0, pregnant: 0, child: 0 },
          locationMap: locationMap || null,
          address: address || location, // Fallback

          createdBy: uid,
          createdAt: new Date(),
        });
      }

      // Sync Admin Roles if campAdmin changed or is new
      if (campAdmin) {
        const oldAdminId = oldCampData?.campAdmin;
        if (oldAdminId !== campAdmin) {
          await syncAdminRole(disasterId, campId, oldAdminId, campAdmin, "campAdmin");
        }
      }

      reply
        .status(200)
        .send({ message: "Camp created/updated", success: true, _id: campId });
    } catch (error) {
      console.error(error);
      reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  fastify.get("/getCamps", isAdmin, async (req, reply) => {
    try {
      const { disasterId } = req.query;
      const list = await fastify.mongo.db
        .collection("camps")
        .find({ disasterId })
        .toArray();
      reply.send(list);
    } catch (error) {
      reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  fastify.get("/getCampNames", isAuthUser, async (req, reply) => {
    try {
      const { disasterId } = req.query;
      const list = await fastify.mongo.db
        .collection("camps")
        .find({ disasterId }, { projection: { _id: 1, name: 1 } })
        .toArray();
      reply.send({ list });
    } catch (error) {
      reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  fastify.post("/postCollectionPoint", isAdmin, async (req, reply) => {
    try {
      const {
        disasterId,
        location,
        contact,
        collectionAdmin,
        _id,
        uid,
        name,
        status = "active",
        capacity,
        // New Fields
        nearbyHighway, // { exists: boolean, distance: number }
        storage,       // { available: boolean, details: string }
        features,      // String or Array
        locationMap,   // { lat, lng }
        address
      } = req.body;

      let cpId = _id;
      let oldCpData = null;

      // Construct GeoJSON Point if locationMap is valid
      const geoLocation = (locationMap?.lat && locationMap?.lng)
        ? { type: "Point", coordinates: [parseFloat(locationMap.lng), parseFloat(locationMap.lat)] }
        : null;

      if (_id) {
        oldCpData = await fastify.mongo.db.collection("collectionPoints").findOne({ _id, disasterId });
        cpId = _id;
        const set = {
          ...(location && { location }),
          ...(contact && { contact }),
          ...(collectionAdmin && { collectionAdmin }),
          ...(name && { name }),
          ...(status && { status }),

          // New Fields
          ...(nearbyHighway && { nearbyHighway }),
          ...(capacity && { capacity }),
          ...(storage && { storage }),
          ...(features && { features }),
          ...(geoLocation && { geoLocation }), // Save GeoJSON
          ...(address && { address }),

          updatedAt: new Date(),
          updatedBy: uid,
        };
        await fastify.mongo.db.collection("collectionPoints").updateOne(
          { _id, disasterId },
          {
            $set: set
          }
        );
      } else {
        cpId = customIdGenerator("COPT");
        await fastify.mongo.db.collection("collectionPoints").insertOne({
          _id: cpId,
          disasterId,
          location,
          capacity,
          name,
          status,
          collectionAdmin,

          // New Fields
          nearbyHighway: nearbyHighway || { exists: false, distance: 0 },
          storage: storage || { available: false, details: "" },
          features: features || "",
          geoLocation: geoLocation || null, // Save GeoJSON
          address: address || location,

          createdBy: uid,
          disasterId,
          createdAt: new Date(),
        });
      }

      // Sync Admin Roles
      if (collectionAdmin) {
        const oldAdminId = oldCpData?.collectionAdmin;
        if (oldAdminId !== collectionAdmin) {
          await syncAdminRole(disasterId, cpId, oldAdminId, collectionAdmin, "collectionPointAdmin");
        }
      }


      reply
        .status(200)
        .send({ message: "Collection Point created/updated", success: true, _id: cpId });
    } catch (error) {
      console.error(error);
      reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  fastify.get("/getCollectionPoints", isAdmin, async (req, reply) => {
    try {
      const { disasterId } = req.query;
      const list = await fastify.mongo.db
        .collection("collectionPoints")
        .find({ disasterId })
        .toArray();
      reply.send(list);
    } catch (error) {
      reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  // Lookup potential admins by name/phone
  fastify.get("/getPotentialAdmins", isAdmin, async (req, reply) => {
    try {
      const { search } = req.query;
      if (!search) return reply.send([]);

      const users = await fastify.mongo.db.collection("users").find({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { phoneNumber: { $regex: search, $options: 'i' } }
        ]
      }).limit(10).toArray();

      reply.send(users.map(u => ({ _id: u._id, name: u.name, phoneNumber: u.phoneNumber })));

    } catch (error) {
      reply.status(500).send({ message: error.message });
    }
  });

  done();
};
export default disasterRoute;
