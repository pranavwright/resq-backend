/**
 * @param {import("fastify").FastifyInstance} fastify
 * @param {import("fastify").FastifyPluginOptions} options
 * @param {*} done
 */

import { authenticatedUser } from "../../middleware/authMiddleware.js";
import { customIdGenerator } from "../../utils/idGenerator.js";

const loanRoute = (fastify, options, done) => {
    const isAuthUser = {
        preHandler: [(req, reply) => authenticatedUser(fastify, req, reply)],
    };

    fastify.post("/bulkAdd", isAuthUser, async (req, reply) => {
        try {
            const { loans, bankName, branch, disasterId, uid } = req.body;

            if (!loans || !Array.isArray(loans) || loans.length === 0) {
                return reply.status(400).send({ message: "No loan data provided" });
            }

            const collection = fastify.mongo.db.collection("loans");
            let addedCount = 0;
            let skippedCount = 0;

            for (const loan of loans) {
                // Headers mapping: ["Loan No", "Bank Account No", "Customer Address", "Ward No", "Loan Amt", "Due Amount", "Paid Amount"]
                // loan is an array from frontend or object if mapped? 
                // Frontend sends array of arrays or array of objects. Let's handle array of objects for better readability if we map it in frontend, 
                // OR array of arrays if we send raw rows. 
                // Best practice: Frontend maps to objects. I will update Frontend to map to objects before sending.

                const {
                    loanNo,
                    accountNo,
                    address,
                    wardNo,
                    loanAmount,
                    dueAmount,
                    paidAmount
                } = loan;

                if (!loanNo || !accountNo) {
                    skippedCount++; // Invalid data
                    continue;
                }

                // Duplication Check
                const exists = await collection.findOne({
                    loanNo,
                    bankName,
                    branch,
                    disasterId
                });

                if (exists) {
                    skippedCount++;
                    continue;
                }

                await collection.insertOne({
                    _id: customIdGenerator("LOAN_APP"), // Different from 'LOAN' in families? Let's use 'LOAN_APP' to be safe or matches existing pattern.
                    disasterId,
                    bankName,
                    branch,
                    loanNo,
                    accountNo,
                    address,
                    wardNo,
                    loanAmount,
                    dueAmount,
                    paidAmount,
                    createdBy: uid,
                    createdAt: new Date(),
                    status: "active" // Default status
                });
                addedCount++;
            }

            reply.status(200).send({
                message: `Processed ${loans.length} records. Added: ${addedCount}, Skipped (Duplicate/Invalid): ${skippedCount}`,
                addedCount,
                skippedCount
            });

        } catch (error) {
            console.error("Loan Bulk Add Error:", error);
            reply.status(500).send({ message: "Internal Server Error" });
        }
    });

    // Optional: Get Loans route for verifying or displaying logic later
    fastify.get("/list", isAuthUser, async (req, reply) => {
        try {
            const { disasterId } = req.query;
            const list = await fastify.mongo.db.collection("loans").find({ disasterId }).toArray();
            reply.send({ list });
        } catch (error) {
            reply.status(500).send({ message: "Internal Server Error" });
        }
    });

    done();
};

export default loanRoute;
