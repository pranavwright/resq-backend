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

  fastify.get("/getDisasterData", async (req, reply) => {
    try {
      const { disasterId } = req.query;

      if (!disasterId) {
        return reply.status(400).send({ message: "Disaster ID is required" });
      }

      const disasterData = await fastify.mongo.db
        .collection("disasters")
        .aggregate([
          {
            $match: {
              _id: disasterId,
            },
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
              from: "inventory",
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

  fastify.post("/postCamp", isAdmin, async (req, reply) => {
    try {
      const {
        disasterId,
        location,
        contact,
        capacity,
        campAdmin,
        _id,
        uid,
        name,
        status = "active",
      } = req.body;
      if (_id) {
        await fastify.mongo.db.collection("camps").updateOne(
          { _id, disasterId },
          {
            $set: {
              ...(location && { location }),
              ...(contact && { contact }),
              ...(capacity && { capacity }),
              ...(campAdmin && { campAdmin }),
              ...(name && { name }),
              ...(status && { status }),
              updatedAt: new Date(),
              updatedBy: uid,
            },
          }
        );
      } else {
        if (!name || !location) {
          return reply.status(400).send({ message: "All fields are required" });
        }
        await fastify.mongo.db.collection("camps").insertOne({
          _id: customIdGenerator("CMPT"),
          disasterId,
          name,
          location,
          contact,
          capacity,
          campAdmin,
          status,
          createdBy: uid,
          createdAt: new Date(),
        });
      }

      reply
        .status(200)
        .send({ message: "Camp created/updated", success: true });
    } catch (error) {
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
      reply.send({list});
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
      } = req.body;
      if (_id) {
        await fastify.mongo.db.collection("collectionPoints").updateOne(
          { _id, disasterId },
          {
            $set: {
              ...(location && { location }),
              ...(contact && { contact }),
              ...(collectionAdmin && { collectionAdmin }),
              ...(name && { name }),
              ...(status && { status }),
              updatedAt: new Date(),
              updatedBy: uid,
            },
          }
        );
      } else {
        await fastify.mongo.db.collection("collectionPoints").insertOne({
          _id: customIdGenerator("COPT"),
          disasterId,
          location,
          capacity,
          name,
          status,
          collectionAdmin,
          createdBy: uid,
          disasterId,
          createdAt: new Date(),
        });
      }
      reply
        .status(200)
        .send({ message: "Collection Point created/updated", success: true });
    } catch (error) {
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
  done();
};
export default disasterRoute;

const familicollection = {
  _id: "FAM -gsgcjsd",
  disasterId: "DIS -gsgcjsd",
  location: "location",
  capacity: "",
  rationCardNo: "",
  rationCardCategory: "",
  houseName: "",
  currentRecdience: ",",
};

const membersCollection = {
  _id: "MEM -gsgcjsd",
  familyId: "FAM -gsgcjsd",
  name: "name",
  age: "",
};

const roomsCollection = {
  _id: "ROOM -gsgcjsd",
  location: "location",
  state: "",
  district: "",
  houseNo: "",
  source: "",
  rentAmount: "",
  type: "",
};

const campCollection = {
  _id: "CAMP -gsgcjsd",
  disasterId: "DIS -gsgcjsd",
  location: "location",
  contact: "",
  capacity: "",
  campAdmin: "",
  type: "",
};

const collectionPointCollection = {
  _id: "COPT -gsgcjsd",
  disasterId: "DIS -gsgcjsd",
  location: "location",
  contact: "",
  collectionAdmin: "",
  families: "",
};
const collectionPointRoomCollection = {
  _id: "",
  disasterId: "DIS -gsgcjsd",
  roomId: "A11",
  collectionPointId: "",
  ItemId: "",
};

const donationRequestCollection = {
  _id: "",
  disasterId: "DIS -gsgcjsd",
  items: [
    {
      qty: 123,
      itemId: "ITEM -gsgcjsd",
    },
  ],
  deliveryTime: new Date(),
  status: "pending",
};

const inventoryCollection = {
  _id: "ITEM -gsgcjsd",
  name: "name",
  unit: "",
  quantity: "",
  category: "",
  description: "",
};

const campRequestCollection = {
  _id: "",
  disasterId: "DIS -gsgcjsd",
  items: [
    {
      qty: 123,
      itemId: "ITEM -gsgcjsd",
    },
  ],
  pickupTime: new Date(),
  status: "pending",
};

const roomCollection = {
  _id: "",
  disasterId: "",
  location: "google map loaction",
  state: "we",
  district: "we",
  houseNo: "we",
  source: "pravasi/rent/pwd",
  type: "perm/temp",
  isVerified: false,
  rentAmount: "",
  remarks: "",
  readyToOccupy: true,
  familiId: "",
  lastDate: new Date(),
};

const loanCollection = {};
