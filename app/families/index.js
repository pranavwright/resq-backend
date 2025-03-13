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

const familiRoute = (fastify, options, done) => {
  const isAuthUser = {
    preHandler: [(req, reply) => authenticatedUser(fastify, req, reply)],
  };
  const isSurvey = {
    preHandler: [
      (req, reply) => isUserAllowed(fastify, req, reply, ["familySurvey"]),
    ],
  };
  const isAdmin = {
    preHandler: [
      (req, reply) =>
        isUserAllowed(fastify, req, reply, ["superAdmin", "admin"]),
    ],
  };
  const isRoomAdmins = {
    preHandler:[
      (req, reply) => isUserAllowed(fastify, req, reply, ["kas","stat", "admin","roomSurvey"])
    ]
  }

  fastify.post("/addFamily", isSurvey, async (req, reply) => {
    try {
      const {
        _id,
        rationCardNo,
        houseName,
        campId,
        houseNumber,
        address,
        contactNo,
        rationCategory,
        houseHeadCaste,
        members,
        currentResidence,
        disasterId
      } = req.body;
      if (_id) {
        await fastify.mongo.db.collection("family").updateOne(
          { _id , disasterId },
          {
            $set: {
              ...(rationCardNo && { rationCardNo }),
              ...(houseHeadCaste && { houseHeadCaste }),
              ...(houseName && { houseName }),
              ...(campId && { campId }),
              ...(address && { address }),
              ...(contactNo && { contactNo }),
              ...(rationCategory && { rationCategory }),
              ...(currentResidence && { currentResidence }),
              updatedBy: uid,
            },
          }
        );

        for (const member of members) {
          await fastify.mongo.db.collection("members").insertOne(
            { familiId, _id: member._id , disasterId},
            {
              ...member,
            }
          );
        }
      }
      const family = await fastify.mongo.db.collection("family").insertOne({
        _id: customIdGenerator("FAM"),
        rationCardNo,
        houseName,
        houseNumber,
        address,
        contactNo,
        rationCategory,
        houseHeadCaste,
        campId,
        createdBy: uid,
        currentResidence,
        disasterId
      });
      for (const member of members) {
        await fastify.mongo.db.collection("members").insertOne({
          _id: customIdGenerator("MEM"),
          disasterId,
          familiId: family.insertedId,
          ...member,
        });
      }
      reply.status(200).send({ message: "succefully created/updated" });
    } catch (error) {
      reply.status(500).send({ message: error.message });
    }
  });

  fastify.post('/addRooms',isRoomAdmins, async (req, reply) => {
    try {
      const {location, _id, state, district, houseNo, source, rentAmount, type, uid ,disasterId} = req.body;
      if(_id){
        await fastify.mongo.db.collection('rooms').updateOne(
          {_id, disasterId},
          {
            $set:{
              ...(location && {location}),
              ...(state && {state}),
              ...(district && {district}),
              ...(houseNo && {houseNo}),
              ...(source && {source}),
              ...(rentAmount && {rentAmount}),
              ...(type && {type}),
              updatedBy: uid
            }
          });
      }else{
        await fastify.mongo.db.collection('rooms').insertOne({
          _id: customIdGenerator('ROOM'),
          location,
          state,
          district,
          houseNo,
          source,
          rentAmount,
          type,
          createdBy: uid,
          disasterId
        });
      }
      reply.status(200).send({message:"Room created/updated"})
    } catch (error) {
      reply.status(500).send({message:"Internal Server Error"})
    }
  })

  fastify.post('/verifyRoom',isRoomAdmins, async (req, reply) => {
    try {
      const {roomId, readyToOccupy, bedCount, tableCount, toiletCount, electricty, water, nearByShops, nearByHouse, kitchenAccessorics, chairCount, fan, light, uid, disasterId } = req.body;
      await fastify.mongo.db.collection('rooms').updateOne(
        {_id: roomId, disasterId},
        {
          $set:{
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
            verifiedBy: uid
          }
        }
      );
    } catch (error) {
      reply.status(500).send({message:"Internal Server Error"})
    }
  })

  done();
};

export default familiRoute;
