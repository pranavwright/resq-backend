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
        isUserAllowed(fastify, req, reply, ["superAdmin", "admin"]),
    ],
  };
  fastify.post("/postDisaster", isSuperAdmin, async (req, reply) => {
    try {
      const {
        _id,
        name,
        description,
        location,
        startDate,
        endDate = new Date(),
        status = "active",
        state,
        district,
        severity,
        donationStatus = "active",
        uid,
      } = req.body;
      if (_id) {

        await fastify.mongo.db.collection("disasters").updateOne(
          { _id },
          {
            $set: {
              ...(endDate && { endDate }),
              ...(status && { status }),
              ...(name && { name }),
              ...(description && { description }),
              ...(location && { location }),
              ...(severity && { severity }),
              ...(donationStatus && { donationStatus }),
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
          !severity
        ) {
          return reply.status(400).send({ message: "All fields are required" });
        }
        await fastify.mongo.db.collection("disasters").insertOne({
          _id: customIdGenerator("DIST"),
          name,
          description,
          location,
          startDate,
          status: "active",
          state,
          district,
          severity,
          donationStatus: "active",
          createdBy: uid,
          createdAt: new Date(),
        });
      }
      reply.status(200).send({ message: "Disaster created/updated" });
    } catch (error) {
      reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  fastify.get("/getDisasters", isSuperAdmin, async (req, reply) => {
    try {
      const list = await fastify.mongo.db.collection('disaster').find().toArray();
      reply.send(list)
    } catch (error) {
      reply.status(500).sent({ message: "Internal Server Error" });
    }
  });

  fastify.post("/camp", isAdmin, async (req, reply) => {
    try {
      const { disasterId, location, contact, capacity, campAdmin, _id, uid } =
        req.body;
      if (_id) {
        await fastify.mongo.db.collection("camps").updateOne(
          { _id, disasterId },
          {
            $set: {
              ...(location && { location }),
              ...(contact && { contact }),
              ...(capacity && { capacity }),
              ...(campAdmin && { campAdmin }),
              updatedAt: new Date(),
              updatedBy: uid,
            },
          }
        );
      } else {
        await fastify.mongo.db.collection("camps").insertOne({
          _id: customIdGenerator("CMPT"),
          disasterId,
          location,
          contact,
          capacity,
          campAdmin,
          disasterId,
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
  fastify.post("/collectionPoint", isAdmin, async (req, reply) => {
    try {
      const { disasterId, location, contact, collectionAdmin, _id, uid } =
        req.body;
      if (_id) {
        await fastify.mongo.db.collection("collectionPoints").updateOne(
          { _id, disasterId },
          {
            $set: {
              ...(location && { location }),
              ...(contact && { contact }),
              ...(collectionAdmin && { collectionAdmin }),
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
