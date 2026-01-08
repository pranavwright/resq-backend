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

        const today = new Date().toISOString().split('T')[0];

        const systemPrompt = `
          You are an AI that converts natural language queries into structured filters for a Families data table.
          
          User Query: "${prompt}"
          Schema Context: ${JSON.stringify(schema || {})}
          Current Date: ${today}
          
          Goal:
          1. Generate a list of filters matching the user's intent.
          2. Suggest columns to display.

          Data Structure:
          - 'family' collection (root): ward, village, rationCardNo, contactNo, houseHead, etc.
          - 'members' collection (looked up as 'members' array): name, dob (date), gender, education, etc.
          
          Output JSON ONLY with this format:
          {
            "filters": [
              { "field": "columnKey", "operator": "contains|equals|starts_with|ends_with|gt|lt|gte|lte", "value": "someValue" }
            ], 
            "columns": ["field1", "field2"]
          }
          
          Rules:
          - Return PURE JSON. No markdown formatting.
          - Use 'gt', 'lt', 'gte', 'lte' for numeric and date comparisons.
          - **CRITICAL**: If user asks about AGE (e.g., "Age < 10"), you MUST convert it to 'dob' (Date of Birth) filters.
             - Age < X  => dob > [Date X years ago from today]
             - Age > X  => dob < [Date X years ago from today]
             - Age = X  => dob between [Date X years ago] and [Date X+1 years ago] (or just use approximate range).
             - Calculate the exact dates based on 'Current Date'.
          - Use 'contains' for fuzzy text matching.
          - 'field' must match schema keys provided.
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
