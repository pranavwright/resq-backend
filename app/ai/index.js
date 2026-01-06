import {
  authenticatedUser,
  isUserAllowed,
} from "../../middleware/authMiddleware.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

const aiRoute = (fastify, options, done) => {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  fastify.post(
    "/filter",
    {
      preHandler: [
        (req, reply) => authenticatedUser(fastify, req, reply),
      ],
    },
    async (req, reply) => {
      try {
        const { prompt, schema } = req.body; // Schema implies the fields available for filtering

        if (!prompt) {
          return reply.status(400).send({ message: "Prompt is required" });
        }

        const systemPrompt = `
          You are an AI that converts natural language queries into MongoDB aggregation pipelines and selects columns to display.
          
          User Query: "${prompt}"
          Schema Context: ${JSON.stringify(schema || {})}
          
          Goal:
          1. Generate a MongoDB aggregation pipeline for the 'family' collection.
          2. Suggest columns to display based on the query.

          Data Structure:
          - 'family' collection (root): ward, village, rationCardNo, contactNo, houseHead, etc.
          - 'members' collection (looked up as 'members' array): name, dob (date), gender, education, etc.
          
          Output JSON ONLY with this format:
          {
            "mongoQuery": { ... }, // The filter object for $match or a full pipeline if needed (usually just match criteria).
            "columns": ["field1", "field2"] // Columns to show.
          }
          
          Rules:
          - Return PURE JSON. No markdown formatting (no \`\`\`json).
          - For dates/ages, use appropriate comparisons ($lt, $gt) relative to now.
          - If fields are specific to members, ensure you filter correctly (e.g., 'members.age').
        `;

        const generationConfig = {
          temperature: 0.1, // Lower temperature for more deterministic JSON
          topK: 32,
          topP: 1,
          maxOutputTokens: 2048, // Increased limits
          responseMimeType: "application/json",
        };

        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: systemPrompt }] }],
          generationConfig,
        });

        const response = result.response;
        let text = response.text();

        // Cleanup markdown/text
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();

        console.log("AI Output:", text); // Debug log

        const jsonResponse = JSON.parse(text);

        reply.send(jsonResponse);

      } catch (error) {
        console.error("AI Error:", error);
        reply.status(500).send({ message: "AI processing failed" });
      }
    }
  );

  done();
};

export default aiRoute;
