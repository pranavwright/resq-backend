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

  fastify.post('/addFamily', isSurvey, async (req, reply) => {
    try {
        const {_id, rationCardNo, houseName, houseNumber, address, contactNo, rationCategory, houseHeadCaste, members   } = req.body;
        if(_id){
            const family = await fastify.mongo.db.collection('family').findOne({_id})
        
        }
        let membersId = [];
        const family = await fastify.mongo.db.collection('family').insertOne({
            _id: customIdGenerator("FAM"),
            rationCardNo,
            houseName,
            houseNumber,
            address,
            contactNo,
            rationCategory,
            houseHeadCaste,
            members: membersId,
        })
        for (const member of members) {
            const mem = await fastify.mongo.db.collection('members').insertOne({
                _id: customIdGenerator("MEM"),
                familiId: family.insertedId,
                ...member,
            })
            membersId.push(mem.insertedId)
        }
    } catch (error) {
        reply.status(500).send({message: error.message})
    }
  })

  done();
}

export default familiRoute