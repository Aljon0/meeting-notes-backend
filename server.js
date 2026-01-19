// server.js
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import Groq from 'groq-sdk';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Validate API key before initializing Groq client
if (!process.env.GROQ_API_KEY) {
    console.error('❌ ERROR: GROQ_API_KEY is not set in environment variables');
    console.error('Please make sure your .env file contains: GROQ_API_KEY=your_api_key_here');
    process.exit(1);
}

// Initialize Groq client
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Main endpoint: Extract action items from meeting notes
app.post('/api/extract-action-items', async (req, res) => {
    try {
        const { notes } = req.body;

        // Validation
        if (!notes || typeof notes !== 'string') {
            return res.status(400).json({
                error: 'Invalid input. Please provide meeting notes as a string.'
            });
        }

        if (notes.trim().length < 10) {
            return res.status(400).json({
                error: 'Meeting notes too short. Please provide at least 10 characters.'
            });
        }

        if (notes.length > 50000) {
            return res.status(400).json({
                error: 'Meeting notes too long. Please limit to 50,000 characters.'
            });
        }

        // Call Groq API with structured prompt
        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: `You are an expert assistant that extracts action items from meeting notes. 
          
Analyze the meeting notes and extract ALL action items, tasks, or commitments mentioned.

For each action item, provide:
1. task: Clear description of what needs to be done
2. assignee: Person's name if mentioned (null if not specified)
3. priority: Classify as "high", "medium", or "low" based on urgency indicators
4. deadline: Any mentioned date/time (null if not specified)
5. context: Brief context from the meeting (1 sentence)

IMPORTANT: Respond ONLY with valid JSON. No markdown, no explanations, just the JSON object.

Format:
{
  "actionItems": [
    {
      "task": "string",
      "assignee": "string or null",
      "priority": "high|medium|low",
      "deadline": "string or null",
      "context": "string"
    }
  ],
  "summary": "One sentence summary of the meeting"
}`
                },
                {
                    role: 'user',
                    content: `Extract action items from these meeting notes:\n\n${notes}`
                }
            ],
            model: 'llama-3.3-70b-versatile', // Fast and accurate
            temperature: 0.3, // Lower temperature for consistent extraction
            max_tokens: 2000,
            response_format: { type: 'json_object' } // Ensure JSON response
        });

        const responseText = completion.choices[0]?.message?.content;

        if (!responseText) {
            throw new Error('No response from AI');
        }

        // Parse and validate response
        let parsedResponse;
        try {
            parsedResponse = JSON.parse(responseText);
        } catch (parseError) {
            console.error('JSON parse error:', parseError);
            throw new Error('Invalid response format from AI');
        }

        // Add unique IDs to action items
        if (parsedResponse.actionItems && Array.isArray(parsedResponse.actionItems)) {
            parsedResponse.actionItems = parsedResponse.actionItems.map((item, index) => ({
                id: `item-${Date.now()}-${index}`,
                ...item
            }));
        }

        res.json(parsedResponse);

    } catch (error) {
        console.error('Error processing request:', error);

        // Handle specific error types
        if (error.message?.includes('API key')) {
            return res.status(500).json({
                error: 'API configuration error. Please contact support.'
            });
        }

        if (error.message?.includes('rate limit')) {
            return res.status(429).json({
                error: 'Too many requests. Please try again in a moment.'
            });
        }

        res.status(500).json({
            error: 'Failed to process meeting notes. Please try again.'
        });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📝 Health check: http://localhost:${PORT}/health`);
});