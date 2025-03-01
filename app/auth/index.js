
/**
 * @param {import("fastify").FastifyInstance} fastify The date
 * @param {import("fastify").FastifyPluginOptions} options The string
 * @param {*} done The string
*/

import { customIdGenerator } from "../../utils/idGenerator";



const authRoute = (fastify, options, done) => {
    fastify.post('/register', async (req, reply) => {
        try {
            const { role, phoneNumber, name, disaterId, } = req.body;
            if (!role || !phoneNumber || !name || !disaterId) {
                reply.status(400).send({ message: "All fields are required" })
            }
            const checkUser = await fastify.mongo.db.collection('users').findOne({ phoneNumber, roles: { $in: [role] }, disaterId });
            if (checkUser) {
                reply.status(400).send({ message: "User already exists" })
            }
            const checkDisater = await fastify.mongo.db.collection('disasters').findOne({ disaterId });
            if (!checkDisater) {
                reply.status(400).send({ message: "Disater not found" })
            }
            const checkOldUser = await fastify.mongo.db.collection('users').findOne({ phoneNumber, disaterId: { $ne: disaterId } });
            if (checkOldUser) {
                await fastify.mongo.db.collection('users').updateOne({ phoneNumber },
                    {
                        $set: {
                            pastWorks: { $push: checkOldUser.disaterId },
                            roles: [role],
                            disaterId
                        }
                    }
                )
                return reply.status(200).send({ message: "User updated successfully" });
            }

            const user = await fastify.mongo.db.collection('users').findOne({ phoneNumber, disaterId });
            if (user) {
                await fastify.mongo.db.collection('users').updateOne({ phoneNumber, disaterId }, { $push: { roles: role } });
            } else {
                await fastify.mongo.db.collection('users').insertOne({ _id: customIdGeneratorr("user"), roles: { $push: [role] }, phoneNumber, name, disaterId });
            }
            reply.status(200).send({ message: "User created successfully" });

        } catch (error) {
            console.log("Error In Register Route", error);
            reply.status(500).send({ message: "Internal Server Error" });

        }
    })
    fastify.post('/checkUser', async (req, reply) => {
        try {
           const {phoneNumber} = req.body;
           if(!phoneNumber){
            reply.status(400).send({ message: "Phone number is required" })
           }
           const checkuser = await fastify.mongo.db.collection('users').findOne({phoneNumber});
           if(!checkuser){
            reply.status(400).send({ message: "User not found" })
           }
           reply.status(200).send({ message: "User found" });
        } catch (error) {
            console.log("Error In Login Route", error);
            reply.status(500).send({ message: "Internal Server Error" })
        }
    })
    fastify.post('/verify-firebase-token', async (req, reply) => {
        try {
          const { firebaseToken } = req.body;
          const decodedToken = await admin.auth().verifyIdToken(firebaseToken);
      
          // Create a user if they don’t exist
          if (!users[decodedToken.uid]) {
            users[decodedToken.uid] = {
              uid: decodedToken.uid,
              phone: decodedToken.phone_number,
            };
          }
      
          // Generate JWT Token
          const jwtToken = fastify.jwt.sign({ uid: decodedToken.uid, phoneNumber: decodedToken.phone_number });
          return reply.send({ jwtToken });
        } catch (error) {
          return reply.status(400).send({ message: 'Invalid Firebase Token', error });
        }
      });

    done();
}
export default authRoute;