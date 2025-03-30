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

const familyRoute = (fastify, options, done) => {
  const isAuthUser = {
    preHandler: [(req, reply) => authenticatedUser(fastify, req, reply)],
  };
  const isSurvey = {
    preHandler: [
      (req, reply) => isUserAllowed(fastify, req, reply, ["surveyOfficial"]),
    ],
  };
  const isAdmin = {
    preHandler: [
      (req, reply) =>
        isUserAllowed(fastify, req, reply, ["superAdmin", "admin"]),
    ],
  };
  const isRoomAdmins = {
    preHandler: [
      (req, reply) =>
        isUserAllowed(fastify, req, reply, [
          "kas",
          "stat",
          "admin",
          "verifyOfficial",
        ]),
    ],
  };

  fastify.post("/addFamily", isSurvey, async (req, reply) => {
    try {
      const { _id, members, uid, disasterId } = req.body;
      if (!disasterId) {
        return reply.status(400).send({ message: "disasterId required" });
      }
      let famData = req.body;
      delete famData._id;
      delete famData.disasterId;
      delete famData.members;
      delete famData.disasterId;
      delete famData.uid;
      if (_id) {
        await fastify.mongo.db.collection("family").updateOne(
          { _id, disasterId },
          {
            $set: {
              ...famData,
              updatedBy: uid,
            },
          }
        );

        for (const member of members) {
          await fastify.mongo.db.collection("members").insertOne(
            { familyId: _id, _id: member._id, disasterId },
            {
              ...member,
            }
          );
        }
      } else {
        const family = await fastify.mongo.db.collection("family").insertOne({
          _id: customIdGenerator("FAM"),
          ...famData,
          createdBy: uid,
          disasterId,
        });
        for (const member of members) {
          await fastify.mongo.db.collection("members").insertOne({
            _id: customIdGenerator("MEM"),
            disasterId,
            familyId: family.insertedId,
            createdBy: uid,
            ...member,
          });
        }
      }

      reply.status(200).send({ message: "succefully created/updated" });
    } catch (error) {
      reply.status(500).send({ message: error.message });
    }
  });

  fastify.post("/addRooms", isRoomAdmins, async (req, reply) => {
    try {
      const {
        location,
        _id,
        state,
        district,
        houseNo,
        source,
        rentAmount,
        type,
        uid,
        disasterId,
      } = req.body;
      if (_id) {
        await fastify.mongo.db.collection("rooms").updateOne(
          { _id, disasterId },
          {
            $set: {
              ...(location && { location }),
              ...(state && { state }),
              ...(district && { district }),
              ...(houseNo && { houseNo }),
              ...(source && { source }),
              ...(rentAmount && { rentAmount }),
              ...(type && { type }),
              updatedBy: uid,
            },
          }
        );
      } else {
        await fastify.mongo.db.collection("rooms").insertOne({
          _id: customIdGenerator("ROOM"),
          location,
          state,
          district,
          houseNo,
          source,
          rentAmount,
          type,
          createdBy: uid,
          disasterId,
        });
      }
      reply.status(200).send({ message: "Room created/updated" });
    } catch (error) {
      reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  fastify.post("/verifyRoom", isRoomAdmins, async (req, reply) => {
    try {
      const {
        roomId,
        readyToOccupy,
        bedCount,
        tableCount,
        toiletCount,
        electricty,
        water,
        nearByShops,
        nearByHouse,
        kitchenAccessorics,
        chairCount,
        fan,
        light,
        uid,
        disasterId,
      } = req.body;
      await fastify.mongo.db.collection("rooms").updateOne(
        { _id: roomId, disasterId },
        {
          $set: {
            readyToOccupy,
            bedCount,
            tableCount,
            toiletCount,
            electricty,
            water,
            nearByShops,
            nearByHouse,
            kitchenAccessorics,
            chairCount,
            fan,
            light,
            verifiedBy: uid,
          },
        }
      );
    } catch (error) {
      reply.status(500).send({ message: "Internal Server Error" });
    }
  });
  fastify.get("/meAddedFamilies", isSurvey, async (req, reply) => {
    try {
      const { disasterId, uid } = req.query;
      const list = await fastify.mongo.db
        .collection("family")
        .aggregate([
          {
            $match: { disasterId, createdBy: uid },
          },
          {
            $lookup: {
              from: "members",
              localField: "_id",
              foreignField: "familyId",
              as: "members",
            },
          },
        ])
        .toArray();

      reply.send({ list });
    } catch (error) {
      reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  done();
};

export default familyRoute;
