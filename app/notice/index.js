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

const noticeRoute = (fastify, options, done) => {
  const isAuthUser = {
    preHandler: [(req, reply) => authenticatedUser(fastify, req, reply)],
  };

  const isStat = {
    preHandler: [
      (req, reply) => isUserAllowed(fastify, req, reply, ["stat", "admin"]),
    ],
  };
  const isAdmin = {
    preHandler: [(req, reply) => isUserAllowed(fastify, req, reply, ["admin"])],
  };
  fastify.get("/allNotice", isAdmin, async (req, reply) => {
    try {
      const { disasterId } = req.query;
      const list = await fastify.mongo.db
        .collection("notice")
        .find({ disasterId })
        .toArray();

      return reply.status(200).send(list);
    } catch (e) {
      console.log(e);
      return reply.status(500).send({ message: "Internal Server Error" });
    }
  });
  fastify.get("/myNotice", isAdmin, async (req, reply) => {
    try {
      const { disasterId, uid } = req.query;
      if (!disasterId) {
        return reply.status(400).send({ message: "disasterId required" });
      }
      const user = await fastify.mongo.db
        .collection("users")
        .findOne({ _id: uid, "roles.disasterId": disasterId });
      const myRoles = user.roles.find(
        (role) => role.disasterId == disasterId
      ).roles;
      const list = await fastify.mongo.db
        .collection("notice")
        .find({
          disasterId,
          roles: { $in: myRoles },
        })
        .toArray();

      return reply.status(200).send(list);
    } catch (e) {
      console.log(e);
      return reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  fastify.get("/getNotice", isAuthUser, async (req, reply) => {
    try {
      const { disasterId, noticeId } = req.query;
      if (!disasterId || !noticeId) {
        return reply
          .status(400)
          .send({ message: "disasterId and noticeId required" });
      }
      const notice = await fastify.mongo.db
        .collection("notice")
        .findOne({ disasterId, _id: noticeId });
      if (!notice) {
        return reply.status(400).send({ message: "Notice not found" });
      }
      return reply.status(200).send(notice);
    } catch (error) {
      return reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  fastify.get("/allCompletedNotice", isAdmin, async (req, reply) => {
    try {
      const { disasterId } = req.query;
      if (!disasterId) {
        return reply.status(400).send({ message: "disasterId required" });
      }
      const list = await fastify.mongo.db
        .collection("notice")
        .find({ disasterId, status: "completed" })
        .toArray();
      reply.send({ list });
    } catch (error) {
      return reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  fastify.post("/addNotice", isAdmin, async (req, reply) => {
    try {
      const {
        disasterId,
        title,
        description,
        roles,
        priority,
        status,
        uid,
        _id,
      } = req.body;
      if (!disasterId) {
        return reply.status(400).send({ message: "disasterId required" });
      }
      let noticeId;
      if (_id) {
        await fastify.mongo.db.collection("notice").updateOne(
          { _id, disasterId },
          {
            $set: {
              title,
              description,
              roles,
              priority,
              status,
              updatedAt: new Date(),
              updatedBy: uid,
            },
          }
        );
        noticeId = _id;
      } else {
        const noticeData = {
          _id: customIdGenerator("NOTC"),
          title,
          description,
          roles,
          priority,
          status: "pending",
          disasterId,
          createdAt: new Date(),
          createdBy: uid,
        };
        const res = await fastify.mongo.db
          .collection("notice")
          .insertOne(noticeData);
        noticeId = res.insertedId;
      }
      const usersToNotify = await fastify.mongo.db
        .collection("users")
        .find({ "roles.roles": { $in: roles }, disasterId })
        .toArray();

      const notificationPayload = {
        notification: {
          title: "New Notice Posted",
          body: `A new notice titled "${title}" has been posted.`,
        },
        data: {
          noticeId: noticeId.toString(),
          disasterId: disasterId.toString(),
          title: title,
        },
      };

      for (const user of usersToNotify) {
        if (user.fcmToken) {
          try {
            await fastify.firebaseAdmin.messaging().send({
              ...notificationPayload,
              token: user.fcmToken,
            });
            console.log(
              `Notification sent to user ${user._id} with FCM token: ${user.fcmToken}`
            );
          } catch (error) {
            console.error(
              `Error sending notification to user ${user._id}:`,
              error
            );
          }
        } else {
          console.warn(`User ${user._id} does not have an FCM token.`);
        }
      }

      return reply.status(200).send({ message: "Notice added successfully" });
    } catch (e) {
      console.log(e);
      return reply.status(500).send({ message: "Internal Server Error" });
    }
  });

  fastify.post("/updateNotice", isAuthUser, async (req, reply) => {
    try {
      const { uid, status, disasterId, remarks, noticeId } = req.body;
      if (!noticeId || !disasterId || !status) {
        return reply
          .status(400)
          .send({ message: "noticeId, disasterId and status required" });
      }

      await fastify.mongo.db.collection("notice").updateOne(
        { _id: noticeId, disasterId },
        {
          $set: {
            status,
            ...(remarks && { remarks }),
            updatedAt: new Date(),
            updateBy: uid,
          },
        }
      );
      reply.send({ message: "Notice updated successfully", success: true });
    } catch (error) {
      return reply.status(500).send({ message: "Internal Server Error" });
    }
  });
  done();
};
export default noticeRoute;
