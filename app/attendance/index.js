
import {
    authenticatedUser,
    isUserAllowed,
} from "../../middleware/authMiddleware.js";
import { customIdGenerator } from "../../utils/idGenerator.js";

const attendanceRoute = (fastify, options, done) => {
    const isCampAdmin = {
        preHandler: [
            (req, reply) =>
                isUserAllowed(fastify, req, reply, ["campAdmin", "admin", "superAdmin"]),
        ],
    };

    // Get attendance for a specific date and camp
    fastify.get("/getAttendance", isCampAdmin, async (req, reply) => {
        try {
            const { campId, date } = req.query;

            if (!campId || !date) {
                return reply.status(400).send({ message: "campId and date are required" });
            }

            // Ensure date is start of day for consistency
            const queryDate = new Date(date);
            queryDate.setHours(0, 0, 0, 0);

            const record = await fastify.mongo.db.collection("attendance").findOne({
                campId,
                date: queryDate
            });

            reply.send(record || { attendance: [] });
        } catch (error) {
            console.error(error);
            reply.status(500).send({ message: "Internal Server Error" });
        }
    });

    // Mark/Update attendance
    fastify.post("/markAttendance", isCampAdmin, async (req, reply) => {
        try {
            const {
                campId,
                date,
                attendance, // Array of { memberId, morning, evening, morningRemark, eveningRemark }
                uid,
                disasterId
            } = req.body;

            if (!campId || !date || !attendance) {
                return reply.status(400).send({ message: "Missing required fields" });
            }

            const queryDate = new Date(date);
            queryDate.setHours(0, 0, 0, 0);

            const updateDoc = {
                $set: {
                    attendance,
                    updatedBy: uid,
                    updatedAt: new Date(),
                    disasterId // Ensure disasterId is part of the record
                },
                $setOnInsert: {
                    _id: customIdGenerator("ATT"),
                    campId,
                    date: queryDate,
                    createdBy: uid,
                    createdAt: new Date()
                }
            };

            await fastify.mongo.db.collection("attendance").updateOne(
                { campId, date: queryDate },
                updateDoc,
                { upsert: true }
            );

            reply.send({ message: "Attendance updated successfully" });
        } catch (error) {
            console.error(error);
            reply.status(500).send({ message: "Internal Server Error" });
        }
    });

    done();
};

export default attendanceRoute;
